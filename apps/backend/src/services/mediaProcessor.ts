import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker as NodeWorker } from 'node:worker_threads'
import { randomBytes } from 'node:crypto'
import { Queue, QueueEvents, Worker as BullWorker } from 'bullmq'
import { Redis } from 'ioredis'
import { processImage, processVideo, type ImageProcessingResult, type VideoProcessingResult } from './media.js'

export type MediaProcessingMode = 'inline' | 'worker-thread' | 'bullmq'

type MediaProcessorConfig = {
  mode: MediaProcessingMode
  concurrency: number
  jobTimeoutMs: number
  redisUrl: string | null
}

type WorkerRequest =
  | {
      jobId: string
      kind: 'image'
      input: Uint8Array
      mimeType: string
      stripExif: boolean
      requestId?: string
    }
  | {
      jobId: string
      kind: 'video'
      input: Uint8Array
      requestId?: string
    }

type WorkerResponse =
  | {
      jobId: string
      ok: true
      kind: 'image'
      result: {
        thumb: Uint8Array
        display: Uint8Array
        original: Uint8Array
        blurDataUrl: string
      }
    }
  | {
      jobId: string
      ok: true
      kind: 'video'
      result: {
        poster: Uint8Array
        blurDataUrl: string
        durationSeconds: number
      }
    }
  | {
      jobId: string
      ok: false
      error: string
    }

type WorkerTask = {
  request: WorkerRequest
  resolve: (value: ImageProcessingResult | VideoProcessingResult) => void
  reject: (error: Error) => void
}

type BullJobData =
  | {
      kind: 'image'
      inputPath: string
      mimeType: string
      stripExif: boolean
      requestId?: string
    }
  | {
      kind: 'video'
      inputPath: string
      requestId?: string
    }

type BullJobResult =
  | {
      kind: 'image'
      thumbPath: string
      displayPath: string
      originalPath: string
      blurDataUrl: string
    }
  | {
      kind: 'video'
      posterPath: string
      blurDataUrl: string
      durationSeconds: number
    }

export type MediaProcessor = {
  processImage: (
    inputBuffer: Buffer,
    mimeType: string,
    options?: { stripExif?: boolean; requestId?: string }
  ) => Promise<ImageProcessingResult>
  processVideo: (inputBuffer: Buffer, options?: { requestId?: string }) => Promise<VideoProcessingResult>
  close: () => Promise<void>
}

const BULLMQ_QUEUE_NAME = 'wps-media-processing'

class InlineMediaProcessor implements MediaProcessor {
  async processImage(
    inputBuffer: Buffer,
    mimeType: string,
    options: { stripExif?: boolean; requestId?: string } = {}
  ): Promise<ImageProcessingResult> {
    return processImage(inputBuffer, mimeType, options)
  }

  async processVideo(
    inputBuffer: Buffer,
    _options: { requestId?: string } = {}
  ): Promise<VideoProcessingResult> {
    return processVideo(inputBuffer)
  }

  async close(): Promise<void> {}
}

class WorkerThreadMediaProcessor implements MediaProcessor {
  private readonly workers: Array<{ worker: NodeWorker; currentJobId: string | null }> = []
  private readonly pending: WorkerTask[] = []
  private readonly inFlight = new Map<string, WorkerTask>()
  private closing = false

  constructor(concurrency: number) {
    for (let i = 0; i < Math.max(1, concurrency); i += 1) {
      this.workers.push(this.createWorkerSlot())
    }
  }

  async processImage(
    inputBuffer: Buffer,
    mimeType: string,
    options: { stripExif?: boolean; requestId?: string } = {}
  ): Promise<ImageProcessingResult> {
    const request: WorkerRequest = {
      jobId: createJobId(options.requestId),
      kind: 'image',
      input: Uint8Array.from(inputBuffer),
      mimeType,
      stripExif: options.stripExif ?? true,
      requestId: options.requestId,
    }

    const result = await this.enqueue(request)
    if (!('thumb' in result)) {
      throw new Error('Invalid worker response for image processing')
    }
    return result
  }

  async processVideo(
    inputBuffer: Buffer,
    options: { requestId?: string } = {}
  ): Promise<VideoProcessingResult> {
    const request: WorkerRequest = {
      jobId: createJobId(options.requestId),
      kind: 'video',
      input: Uint8Array.from(inputBuffer),
      requestId: options.requestId,
    }

    const result = await this.enqueue(request)
    if (!('poster' in result)) {
      throw new Error('Invalid worker response for video processing')
    }
    return result
  }

  async close(): Promise<void> {
    this.closing = true
    while (this.pending.length > 0) {
      const task = this.pending.shift()
      task?.reject(new Error('Media processor is shutting down'))
    }

    for (const [jobId, task] of this.inFlight.entries()) {
      this.inFlight.delete(jobId)
      task.reject(new Error('Media processor is shutting down'))
    }

    await Promise.all(this.workers.map(({ worker }) => worker.terminate()))
    this.workers.length = 0
  }

  private enqueue(request: WorkerRequest): Promise<ImageProcessingResult | VideoProcessingResult> {
    if (this.closing) {
      return Promise.reject(new Error('Media processor is already closed'))
    }

    return new Promise((resolve, reject) => {
      this.pending.push({ request, resolve, reject })
      this.schedule()
    })
  }

  private schedule() {
    if (this.closing) return

    for (const slot of this.workers) {
      if (slot.currentJobId !== null) continue
      const task = this.pending.shift()
      if (!task) return

      slot.currentJobId = task.request.jobId
      this.inFlight.set(task.request.jobId, task)
      const transferableInput = Uint8Array.from(task.request.input)
      const request: WorkerRequest = {
        ...task.request,
        input: transferableInput,
      }
      slot.worker.postMessage(request, [transferableInput.buffer])
    }
  }

  private createWorkerSlot(): { worker: NodeWorker; currentJobId: string | null } {
    const workerUrl = resolveMediaWorkerUrl()
    const worker = new NodeWorker(workerUrl, { execArgv: process.execArgv })
    const slot = { worker, currentJobId: null as string | null }

    worker.on('message', (message: WorkerResponse) => {
      const jobId = slot.currentJobId
      if (!jobId) return

      const task = this.inFlight.get(jobId)
      this.inFlight.delete(jobId)
      slot.currentJobId = null

      if (!task) {
        this.schedule()
        return
      }

      if (!message.ok) {
        task.reject(new Error(message.error))
        this.schedule()
        return
      }

      if (message.kind === 'image') {
        task.resolve({
          thumb: Buffer.from(message.result.thumb),
          display: Buffer.from(message.result.display),
          original: Buffer.from(message.result.original),
          blurDataUrl: message.result.blurDataUrl,
        })
      } else {
        task.resolve({
          poster: Buffer.from(message.result.poster),
          blurDataUrl: message.result.blurDataUrl,
          durationSeconds: message.result.durationSeconds,
        })
      }

      this.schedule()
    })

    worker.on('error', (error) => {
      const jobId = slot.currentJobId
      if (jobId) {
        const task = this.inFlight.get(jobId)
        this.inFlight.delete(jobId)
        slot.currentJobId = null
        task?.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    worker.on('exit', () => {
      if (this.closing) return

      const index = this.workers.indexOf(slot)
      if (index >= 0) {
        this.workers[index] = this.createWorkerSlot()
      }
      this.schedule()
    })

    return slot
  }
}

class BullMqMediaProcessor implements MediaProcessor {
  private readonly queue: Queue<BullJobData, BullJobResult>
  private readonly queueEvents: QueueEvents
  private readonly worker: BullWorker<BullJobData, BullJobResult>
  private readonly queueConnection: Redis
  private readonly workerConnection: Redis
  private readonly eventsConnection: Redis
  private readonly jobTimeoutMs: number

  constructor(options: { redisUrl: string; concurrency: number; jobTimeoutMs: number }) {
    this.queueConnection = new Redis(options.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
    this.workerConnection = this.queueConnection.duplicate()
    this.eventsConnection = this.queueConnection.duplicate()
    this.jobTimeoutMs = options.jobTimeoutMs

    this.queue = new Queue<BullJobData, BullJobResult>(BULLMQ_QUEUE_NAME, {
      connection: this.queueConnection,
    })
    this.queueEvents = new QueueEvents(BULLMQ_QUEUE_NAME, {
      connection: this.eventsConnection,
    })
    this.worker = new BullWorker<BullJobData, BullJobResult>(
      BULLMQ_QUEUE_NAME,
      async (job) => runBullJob(job.data),
      {
        connection: this.workerConnection,
        concurrency: Math.max(1, options.concurrency),
      }
    )
  }

  async processImage(
    inputBuffer: Buffer,
    mimeType: string,
    options: { stripExif?: boolean; requestId?: string } = {}
  ): Promise<ImageProcessingResult> {
    const inputPath = await writeTempFile('wps-bullmq-input', '.bin', inputBuffer)
    let completedResult: BullJobResult | null = null
    const job = await this.queue.add('image', {
      kind: 'image',
      inputPath,
      mimeType,
      stripExif: options.stripExif ?? true,
      requestId: options.requestId,
    }, { removeOnComplete: 500, removeOnFail: 500 })

    try {
      const result = await job.waitUntilFinished(this.queueEvents, this.jobTimeoutMs) as BullJobResult
      completedResult = result
      if (result.kind !== 'image') {
        throw new Error('Invalid BullMQ response for image processing')
      }

      const [thumb, display, original] = await Promise.all([
        readFile(result.thumbPath),
        readFile(result.displayPath),
        readFile(result.originalPath),
      ])

      return {
        thumb,
        display,
        original,
        blurDataUrl: result.blurDataUrl,
      }
    } finally {
      await unlink(inputPath).catch(() => {})
      if (completedResult?.kind === 'image') {
        await cleanupFiles(completedResult.thumbPath, completedResult.displayPath, completedResult.originalPath)
      }
    }
  }

  async processVideo(
    inputBuffer: Buffer,
    options: { requestId?: string } = {}
  ): Promise<VideoProcessingResult> {
    const inputPath = await writeTempFile('wps-bullmq-input', '.bin', inputBuffer)
    let completedResult: BullJobResult | null = null
    const job = await this.queue.add('video', {
      kind: 'video',
      inputPath,
      requestId: options.requestId,
    }, { removeOnComplete: 500, removeOnFail: 500 })

    try {
      const result = await job.waitUntilFinished(this.queueEvents, this.jobTimeoutMs) as BullJobResult
      completedResult = result
      if (result.kind !== 'video') {
        throw new Error('Invalid BullMQ response for video processing')
      }

      const poster = await readFile(result.posterPath)
      return {
        poster,
        blurDataUrl: result.blurDataUrl,
        durationSeconds: result.durationSeconds,
      }
    } finally {
      await unlink(inputPath).catch(() => {})
      if (completedResult?.kind === 'video') {
        await cleanupFiles(completedResult.posterPath)
      }
    }
  }

  async close(): Promise<void> {
    await this.worker.close()
    await this.queueEvents.close()
    await this.queue.close()
    await Promise.all([
      this.workerConnection.quit(),
      this.eventsConnection.quit(),
      this.queueConnection.quit(),
    ])
  }
}

export function createMediaProcessor(config: MediaProcessorConfig): MediaProcessor {
  if (config.mode === 'inline') {
    return new InlineMediaProcessor()
  }

  if (config.mode === 'worker-thread') {
    return new WorkerThreadMediaProcessor(config.concurrency)
  }

  if (!config.redisUrl) {
    throw new Error('REDIS_URL is required when MEDIA_PROCESSING_MODE=bullmq')
  }

  return new BullMqMediaProcessor({
    redisUrl: config.redisUrl,
    concurrency: config.concurrency,
    jobTimeoutMs: config.jobTimeoutMs,
  })
}

async function runBullJob(data: BullJobData): Promise<BullJobResult> {
  if (data.kind === 'image') {
    const input = await readFile(data.inputPath)
    try {
      const result = await processImage(input, data.mimeType, {
        stripExif: data.stripExif,
      })
      const [thumbPath, displayPath, originalPath] = await Promise.all([
        writeTempFile('wps-bullmq-output', '.webp', result.thumb),
        writeTempFile('wps-bullmq-output', '.webp', result.display),
        writeTempFile('wps-bullmq-output', '.webp', result.original),
      ])
      return {
        kind: 'image',
        thumbPath,
        displayPath,
        originalPath,
        blurDataUrl: result.blurDataUrl,
      }
    } finally {
      await unlink(data.inputPath).catch(() => {})
    }
  }

  const input = await readFile(data.inputPath)
  try {
    const result = await processVideo(input)
    const posterPath = await writeTempFile('wps-bullmq-output', '.webp', result.poster)
    return {
      kind: 'video',
      posterPath,
      blurDataUrl: result.blurDataUrl,
      durationSeconds: result.durationSeconds,
    }
  } finally {
    await unlink(data.inputPath).catch(() => {})
  }
}

function resolveMediaWorkerUrl(): URL {
  const jsUrl = new URL('../workers/mediaWorker.js', import.meta.url)
  if (existsSync(fileURLToPath(jsUrl))) {
    return jsUrl
  }
  return new URL('../workers/mediaWorker.ts', import.meta.url)
}

function createJobId(requestId?: string): string {
  const suffix = randomBytes(8).toString('hex')
  if (!requestId) return suffix
  const normalized = requestId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
  return normalized.length > 0 ? `${normalized}-${suffix}` : suffix
}

async function writeTempFile(prefix: string, ext: string, data: Buffer | Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  const filePath = join(dir, `${createJobId()}${ext}`)
  await writeFile(filePath, data)
  return filePath
}

async function cleanupFiles(...paths: string[]): Promise<void> {
  await Promise.all(paths.map(async (p) => {
    await unlink(p).catch(() => {})
    await rm(dirname(p), { recursive: true, force: true }).catch(() => {})
  }))
}
