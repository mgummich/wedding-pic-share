import { describe, it, expectTypeOf } from 'vitest'
import type {
  PhotoResponse,
  GalleryResponse,
  UploadResponse,
  PaginatedResponse,
} from '../src/index.js'

describe('shared types', () => {
  it('PhotoResponse has required fields', () => {
    expectTypeOf<PhotoResponse>().toHaveProperty('id')
    expectTypeOf<PhotoResponse>().toHaveProperty('mediaType')
    expectTypeOf<PhotoResponse>().toHaveProperty('thumbUrl')
    expectTypeOf<PhotoResponse>().toHaveProperty('displayUrl')
    expectTypeOf<PhotoResponse>().toHaveProperty('duration')
    expectTypeOf<PhotoResponse>().toHaveProperty('guestName')
    expectTypeOf<PhotoResponse>().toHaveProperty('createdAt')
  })

  it('GalleryResponse has required fields', () => {
    expectTypeOf<GalleryResponse>().toHaveProperty('id')
    expectTypeOf<GalleryResponse>().toHaveProperty('slug')
    expectTypeOf<GalleryResponse>().toHaveProperty('layout')
    expectTypeOf<GalleryResponse>().toHaveProperty('guestNameMode')
    expectTypeOf<GalleryResponse>().toHaveProperty('photoCount')
  })

  it('UploadResponse has required fields', () => {
    expectTypeOf<UploadResponse>().toHaveProperty('id')
    expectTypeOf<UploadResponse>().toHaveProperty('status')
    expectTypeOf<UploadResponse>().toHaveProperty('mediaType')
    expectTypeOf<UploadResponse>().toHaveProperty('thumbUrl')
    expectTypeOf<UploadResponse>().toHaveProperty('duration')
  })

  it('mediaType is IMAGE | VIDEO', () => {
    type MediaType = PhotoResponse['mediaType']
    expectTypeOf<MediaType>().toEqualTypeOf<'IMAGE' | 'VIDEO'>()
  })
})
