import sharp from 'sharp'
import { createHash } from 'crypto'
import { promisify } from 'util'
import { exec } from 'child_process'
import { writeFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

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
  const tmpIn = join(tmpdir(), `wps-video-${Date.now()}.mp4`)
  const tmpPoster = join(tmpdir(), `wps-poster-${Date.now()}.jpg`)

  try {
    await writeFile(tmpIn, inputBuffer)

    // Extract poster frame at 1s (fallback to 0s if video is shorter)
    await execAsync(
      `ffmpeg -y -ss 1 -i "${tmpIn}" -vframes 1 -q:v 2 "${tmpPoster}" 2>/dev/null || ffmpeg -y -i "${tmpIn}" -vframes 1 -q:v 2 "${tmpPoster}"`
    )

    const posterJpeg = await readFile(tmpPoster)
    const poster = await sharp(posterJpeg)
      .resize(400, undefined, { withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()

    const blurDataUrl = await generateBlurDataUrl(poster)

    // Get duration via ffprobe
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmpIn}"`
    )
    const durationSeconds = Math.max(1, Math.round(parseFloat(stdout.trim())))

    return { poster, blurDataUrl, durationSeconds }
  } finally {
    await unlink(tmpIn).catch(() => {})
    await unlink(tmpPoster).catch(() => {})
  }
}

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
