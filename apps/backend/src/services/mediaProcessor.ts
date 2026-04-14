import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker as NodeWorker } from 'node:worker_threads'
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
      inputBase64: string
      mimeType: string
      stripExif: boolean
    }
  | {
      jobId: string
      kind: 'video'
      inputBase64: string
    }

type WorkerResponse =
  | {
      jobId: string
      ok: true
      kind: 'image'
      result: {
        thumbBase64: string
        displayBase64: string
        originalBase64: string
        blurDataUrl: string
      }
    }
  | {
      jobId: string
      ok: true
      kind: 'video'
      result: {
        posterBase64: string
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
      inputBase64: string
      mimeType: string
      stripExif: boolean
    }
  | {
      kind: 'video'
      inputBase64: string
    }

type BullJobResult =
  | {
      kind: 'image'
      thumbBase64: string
      displayBase64: string
      originalBase64: string
      blurDataUrl: string
    }
  | {
      kind: 'video'
      posterBase64: string
      blurDataUrl: string
      durationSeconds: number
    }

export type MediaProcessor = {
  processImage: (
    inputBuffer: Buffer,
    mimeType: string,
    options?: { stripExif?: boolean }
  ) => Promise<ImageProcessingResult>
  processVideo: (inputBuffer: Buffer) => Promise<VideoProcessingResult>
  close: () => Promise<void>
}

const BULLMQ_QUEUE_NAME = 'wps-media-processing'

class InlineMediaProcessor implements MediaProcessor {
  async processImage(
    inputBuffer: Buffer,
    mimeType: string,
    options: { stripExif?: boolean } = {}
  ): Promise<ImageProcessingResult> {
    return processImage(inputBuffer, mimeType, options)
  }

  async processVideo(inputBuffer: Buffer): Promise<VideoProcessingResult> {
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
    options: { stripExif?: boolean } = {}
  ): Promise<ImageProcessingResult> {
    const request: WorkerRequest = {
      jobId: createJobId(),
      kind: 'image',
      inputBase64: inputBuffer.toString('base64'),
      mimeType,
      stripExif: options.stripExif ?? true,
    }

    const result = await this.enqueue(request)
    if (!('thumb' in result)) {
      throw new Error('Invalid worker response for image processing')
    }
    return result
  }

  async processVideo(inputBuffer: Buffer): Promise<VideoProcessingResult> {
    const request: WorkerRequest = {
      jobId: createJobId(),
      kind: 'video',
      inputBase64: inputBuffer.toString('base64'),
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
      slot.worker.postMessage(task.request)
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
          thumb: Buffer.from(message.result.thumbBase64, 'base64'),
          display: Buffer.from(message.result.displayBase64, 'base64'),
          original: Buffer.from(message.result.originalBase64, 'base64'),
          blurDataUrl: message.result.blurDataUrl,
        })
      } else {
        task.resolve({
          poster: Buffer.from(message.result.posterBase64, 'base64'),
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
    options: { stripExif?: boolean } = {}
  ): Promise<ImageProcessingResult> {
    const job = await this.queue.add('image', {
      kind: 'image',
      inputBase64: inputBuffer.toString('base64'),
      mimeType,
      stripExif: options.stripExif ?? true,
    }, { removeOnComplete: 500, removeOnFail: 500 })

    const result = await job.waitUntilFinished(this.queueEvents, this.jobTimeoutMs) as BullJobResult
    if (result.kind !== 'image') {
      throw new Error('Invalid BullMQ response for image processing')
    }

    return {
      thumb: Buffer.from(result.thumbBase64, 'base64'),
      display: Buffer.from(result.displayBase64, 'base64'),
      original: Buffer.from(result.originalBase64, 'base64'),
      blurDataUrl: result.blurDataUrl,
    }
  }

  async processVideo(inputBuffer: Buffer): Promise<VideoProcessingResult> {
    const job = await this.queue.add('video', {
      kind: 'video',
      inputBase64: inputBuffer.toString('base64'),
    }, { removeOnComplete: 500, removeOnFail: 500 })

    const result = await job.waitUntilFinished(this.queueEvents, this.jobTimeoutMs) as BullJobResult
    if (result.kind !== 'video') {
      throw new Error('Invalid BullMQ response for video processing')
    }

    return {
      poster: Buffer.from(result.posterBase64, 'base64'),
      blurDataUrl: result.blurDataUrl,
      durationSeconds: result.durationSeconds,
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
    const result = await processImage(Buffer.from(data.inputBase64, 'base64'), data.mimeType, {
      stripExif: data.stripExif,
    })
    return {
      kind: 'image',
      thumbBase64: result.thumb.toString('base64'),
      displayBase64: result.display.toString('base64'),
      originalBase64: result.original.toString('base64'),
      blurDataUrl: result.blurDataUrl,
    }
  }

  const result = await processVideo(Buffer.from(data.inputBase64, 'base64'))
  return {
    kind: 'video',
    posterBase64: result.poster.toString('base64'),
    blurDataUrl: result.blurDataUrl,
    durationSeconds: result.durationSeconds,
  }
}

function resolveMediaWorkerUrl(): URL {
  const jsUrl = new URL('../workers/mediaWorker.js', import.meta.url)
  if (existsSync(fileURLToPath(jsUrl))) {
    return jsUrl
  }
  return new URL('../workers/mediaWorker.ts', import.meta.url)
}

function createJobId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
