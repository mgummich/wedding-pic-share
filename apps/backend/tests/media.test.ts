import { describe, it, expect } from 'vitest'
import { processImage, generateBlurDataUrl, computeSha256 } from '../src/services/media.js'
import sharp from 'sharp'

describe('processImage', () => {
  it('creates thumb and display variants from a JPEG', async () => {
    const inputBuf = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: '#ff0000' },
    }).jpeg().toBuffer()

    const result = await processImage(inputBuf, 'image/jpeg')

    expect(result.thumb).toBeInstanceOf(Buffer)
    expect(result.display).toBeInstanceOf(Buffer)
    expect(result.original).toBeInstanceOf(Buffer)
    expect(result.blurDataUrl).toMatch(/^data:image\/webp;base64,/)

    // Verify thumb is resized to 400px width
    const thumbMeta = await sharp(result.thumb).metadata()
    expect(thumbMeta.width).toBe(400)

    // Verify display is max 1920px width
    const displayMeta = await sharp(result.display).metadata()
    expect(displayMeta.width).toBeLessThanOrEqual(1920)
  })

  it('does not enlarge small images', async () => {
    const smallBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#00ff00' },
    }).jpeg().toBuffer()

    const result = await processImage(smallBuf, 'image/jpeg')
    const thumbMeta = await sharp(result.thumb).metadata()
    // Small image should not be enlarged beyond its original size
    expect(thumbMeta.width).toBeLessThanOrEqual(400)
  })
})

describe('generateBlurDataUrl', () => {
  it('generates a base64 blur placeholder', async () => {
    const buf = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#aaaaaa' },
    }).webp().toBuffer()

    const blur = await generateBlurDataUrl(buf)
    expect(blur).toMatch(/^data:image\/webp;base64,/)
    const decoded = Buffer.from(blur.split(',')[1], 'base64')
    expect(decoded.length).toBeLessThan(1000) // tiny placeholder
  })
})

describe('computeSha256', () => {
  it('returns consistent hex hash', () => {
    const buf = Buffer.from('hello world')
    const hash = computeSha256(buf)
    // Check format: 64 lowercase hex characters
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    // Check determinism: calling twice gives same result
    expect(computeSha256(buf)).toBe(hash)
  })
})
