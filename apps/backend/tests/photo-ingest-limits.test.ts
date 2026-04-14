import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { ingestUploadedPhoto } from '../src/services/photoIngest.js'

function baseDeps() {
  return {
    gallery: {
      id: 'g1',
      slug: 'party',
      moderationMode: 'MANUAL' as const,
      stripExif: true,
    },
    db: {
      photo: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    },
    storage: {
      save: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      publicUrl: vi.fn(),
      openReadStream: vi.fn(),
      openWriteStream: vi.fn(),
      stat: vi.fn(),
    },
    sse: {
      add: vi.fn(),
      remove: vi.fn(),
      broadcast: vi.fn().mockResolvedValue(undefined),
      sendHeartbeat: vi.fn().mockResolvedValue(undefined),
      connectionCount: vi.fn(),
      close: vi.fn(),
    },
    mediaProcessor: {
      processImage: vi.fn(),
      processVideo: vi.fn(),
      close: vi.fn(),
    },
  }
}

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
      ...baseDeps(),
      upload,
      limits: {
        maxFileSizeMb: 0.00001,
        maxVideoSizeMb: 200,
      },
    })).rejects.toMatchObject({
      statusCode: 413,
      body: expect.objectContaining({ type: 'file-too-large' }),
    })
  })

  it('rejects videos that exceed MAX_VIDEO_SIZE_MB', async () => {
    const tinyMp4Header = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
    const upload = {
      toBuffer: vi.fn().mockResolvedValue(tinyMp4Header),
      fields: {},
    } as unknown as Parameters<typeof ingestUploadedPhoto>[0]['upload']

    await expect(() => ingestUploadedPhoto({
      ...baseDeps(),
      upload,
      limits: {
        maxFileSizeMb: 200,
        maxVideoSizeMb: 0.00001,
      },
    })).rejects.toMatchObject({
      statusCode: 413,
      body: expect.objectContaining({ type: 'file-too-large' }),
    })
  })
})
