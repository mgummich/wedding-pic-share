import { parentPort } from 'node:worker_threads'

const { processImage, processVideo } = await loadMediaModule()

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

if (!parentPort) {
  throw new Error('mediaWorker must run in a worker thread')
}

parentPort.on('message', async (message: WorkerRequest) => {
  try {
    const input = Buffer.from(message.inputBase64, 'base64')

    if (message.kind === 'image') {
      const result = await processImage(input, message.mimeType, { stripExif: message.stripExif })
      const payload: WorkerResponse = {
        jobId: message.jobId,
        ok: true,
        kind: 'image',
        result: {
          thumbBase64: result.thumb.toString('base64'),
          displayBase64: result.display.toString('base64'),
          originalBase64: result.original.toString('base64'),
          blurDataUrl: result.blurDataUrl,
        },
      }
      parentPort?.postMessage(payload)
      return
    }

    const result = await processVideo(input)
    const payload: WorkerResponse = {
      jobId: message.jobId,
      ok: true,
      kind: 'video',
      result: {
        posterBase64: result.poster.toString('base64'),
        blurDataUrl: result.blurDataUrl,
        durationSeconds: result.durationSeconds,
      },
    }
    parentPort?.postMessage(payload)
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
