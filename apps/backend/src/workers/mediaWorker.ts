import { parentPort } from 'node:worker_threads'

const { processImage, processVideo } = await loadMediaModule()

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

if (!parentPort) {
  throw new Error('mediaWorker must run in a worker thread')
}

parentPort.on('message', async (message: WorkerRequest) => {
  try {
    const input = Buffer.from(message.input)

    if (message.kind === 'image') {
      const result = await processImage(input, message.mimeType, { stripExif: message.stripExif })
      const thumb = Uint8Array.from(result.thumb)
      const display = Uint8Array.from(result.display)
      const original = Uint8Array.from(result.original)
      const payload: WorkerResponse = {
        jobId: message.jobId,
        ok: true,
        kind: 'image',
        result: {
          thumb,
          display,
          original,
          blurDataUrl: result.blurDataUrl,
        },
      }
      parentPort?.postMessage(payload, [thumb.buffer, display.buffer, original.buffer])
      return
    }

    const result = await processVideo(input)
    const poster = Uint8Array.from(result.poster)
    const payload: WorkerResponse = {
      jobId: message.jobId,
      ok: true,
      kind: 'video',
      result: {
        poster,
        blurDataUrl: result.blurDataUrl,
        durationSeconds: result.durationSeconds,
      },
    }
    parentPort?.postMessage(payload, [poster.buffer])
  } catch (error) {
    const payload: WorkerResponse = {
      jobId: message.jobId,
      ok: false,
      error: error instanceof Error ? error.message : 'media-worker-failed',
    }
    parentPort?.postMessage(payload)
  }
})

async function loadMediaModule(): Promise<typeof import('../services/media.js')> {
  const jsUrl = new URL('../services/media.js', import.meta.url)
  try {
    return await import(jsUrl.href)
  } catch {
    const tsUrl = new URL('../services/media.ts', import.meta.url)
    return await import(tsUrl.href)
  }
}
