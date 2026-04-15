import sharp from 'sharp'
import { createHash, randomBytes } from 'crypto'
import { promisify } from 'util'
import { exec, execFile } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)
const FFMPEG_TIMEOUT_MS = 30_000
const FFPROBE_TIMEOUT_MS = 15_000
const COMMAND_MAX_BUFFER = 5 * 1024 * 1024

async function runCommand(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: COMMAND_MAX_BUFFER,
    })
  } catch (error) {
    const timedOut = Boolean(
      error
      && typeof error === 'object'
      && 'killed' in error
      && (error as { killed?: boolean }).killed
    )
    if (timedOut) {
      throw new Error(`Command timed out after ${timeoutMs}ms`)
    }
    throw error
  }
}

async function runCommandBuffer(
  binary: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: COMMAND_MAX_BUFFER,
        encoding: 'buffer',
      },
      (error, stdout, stderr) => {
        if (error) {
          const timedOut = Boolean(
            error
            && typeof error === 'object'
            && 'killed' in error
            && (error as { killed?: boolean }).killed
          )
          if (timedOut) {
            reject(new Error(`Command timed out after ${timeoutMs}ms`))
            return
          }
          reject(error)
          return
        }

        resolve({
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
          stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
        })
      }
    )
  })
}

async function extractVideoPosterFrame(inputPath: string, seekSeconds: number | null): Promise<Buffer> {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    ...(seekSeconds === null ? [] : ['-ss', String(seekSeconds)]),
    '-i', inputPath,
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ]

  const { stdout } = await runCommandBuffer('ffmpeg', args, FFMPEG_TIMEOUT_MS)

  const frame = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (frame.length === 0) {
    throw new Error('ffmpeg returned an empty poster frame')
  }
  return frame
}

export interface ImageProcessingResult {
  thumb: Buffer      // 400px wide WEBP
  display: Buffer    // max 1920px wide WEBP
  original: Buffer   // original converted to WEBP
  blurDataUrl: string // base64 10px WEBP placeholder
}

export interface VideoProcessingResult {
  poster: Buffer     // 400px wide WEBP poster frame at 1s
  blurDataUrl: string
  durationSeconds: number
}

export async function processImage(
  inputBuffer: Buffer,
  _mimeType: string,
  options: { stripExif?: boolean } = {}
): Promise<ImageProcessingResult> {
  const stripExif = options.stripExif ?? true
  const base = stripExif
    ? sharp(inputBuffer).keepIccProfile()
    : sharp(inputBuffer).withMetadata().keepIccProfile()

  const thumb = await base
    .clone()
    .resize(400, undefined, { withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()

  const display = await base
    .clone()
    .resize(1920, undefined, { withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer()

  const original = await base.clone().webp({ quality: 95 }).toBuffer()

  const blurDataUrl = await generateBlurDataUrl(thumb)

  return { thumb, display, original, blurDataUrl }
}

export async function generateBlurDataUrl(thumbBuffer: Buffer): Promise<string> {
  const tiny = await sharp(thumbBuffer)
    .resize(10, undefined, { withoutEnlargement: true })
    .webp({ quality: 20 })
    .toBuffer()
  return `data:image/webp;base64,${tiny.toString('base64')}`
}

export async function processVideo(inputBuffer: Buffer): Promise<VideoProcessingResult> {
  const suffix = randomBytes(12).toString('hex')
  const tmpIn = join(tmpdir(), `wps-video-${suffix}.mp4`)

  try {
    await writeFile(tmpIn, inputBuffer)

    // Try 1s first, then 0s for very short clips.
    const posterJpeg = await extractVideoPosterFrame(tmpIn, 1)
      .catch(() => extractVideoPosterFrame(tmpIn, null))
    const poster = await sharp(posterJpeg)
      .resize(400, undefined, { withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()

    const blurDataUrl = await generateBlurDataUrl(poster)

    // Get duration via ffprobe
    const { stdout } = await runCommand(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmpIn}"`,
      FFPROBE_TIMEOUT_MS
    )
    const durationSeconds = Math.max(1, Math.round(parseFloat(stdout.trim())))

    return { poster, blurDataUrl, durationSeconds }
  } finally {
    await unlink(tmpIn).catch(() => {})
  }
}

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
