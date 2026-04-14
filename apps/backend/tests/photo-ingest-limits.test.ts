import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { ingestUploadedPhoto, PhotoIngestError } from '../src/services/photoIngest.js'

describe('ingestUploadedPhoto size limits', () => {
  it('rejects images that exceed MAX_FILE_SIZE_MB', async () => {
    const jpeg = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#aabbcc' },
    }).jpeg().toBuffer()

    const upload = {
      toBuffer: vi.fn().mockResolvedValue(jpeg),
      fields: {},
    } as unknown as Parameters<typeof ingestUploadedPhoto>[0]['upload']

    await expect(() => ingestUploadedPhoto({
      gallery: {
        id: 'g1',
        slug: 'party',
        moderationMode: 'MANUAL',
        stripExif: true,
      },
      upload,
      storage: {
        save: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        publicUrl: vi.fn(),
        filePath: vi.fn(),
      },
      sse: {
        add: vi.fn(),
        remove: vi.fn(),
        broadcast: vi.fn(),
        sendHeartbeat: vi.fn(),
        connectionCount: vi.fn(),
      },
      mediaProcessor: {
        processImage: vi.fn(),
        processVideo: vi.fn(),
        close: vi.fn(),
      },
      limits: {
        maxFileSizeMb: 0.00001,
        maxVideoSizeMb: 200,
      },
    })).rejects.toMatchObject({
      statusCode: 413,
      body: expect.objectContaining({
        type: 'file-too-large',
      }),
    })

    await expect(() => ingestUploadedPhoto({
      gallery: {
        id: 'g1',
        slug: 'party',
        moderationMode: 'MANUAL',
        stripExif: true,
      },
      upload,
      storage: {
        save: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        publicUrl: vi.fn(),
        filePath: vi.fn(),
      },
      sse: {
        add: vi.fn(),
        remove: vi.fn(),
        broadcast: vi.fn(),
        sendHeartbeat: vi.fn(),
        connectionCount: vi.fn(),
      },
      mediaProcessor: {
        processImage: vi.fn(),
        processVideo: vi.fn(),
        close: vi.fn(),
      },
      limits: {
        maxFileSizeMb: 0.00001,
        maxVideoSizeMb: 200,
      },
    })).rejects.toBeInstanceOf(PhotoIngestError)
  })
})
