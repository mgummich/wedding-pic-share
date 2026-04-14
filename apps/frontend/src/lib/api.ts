import type {
  GalleryResponse,
  WeddingResponse,
  PhotoResponse,
  PaginatedResponse,
  UploadResponse,
  UploadWindowResponse,
} from '@wedding/shared'

// Client-side: use relative paths so requests go through the Next.js proxy (/api/v1/* → backend).
// Server-side (SSR/RSC): call the backend directly via the internal service URL.
const BASE_URL =
  typeof window === 'undefined'
    ? (process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000')
    : ''

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string
  ) {
    super(message)
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body, `${res.status}`)
  }
  return res.json()
}

// ─── Gallery ────────────────────────────────────────────────────────────────

export type GalleryPageResponse = GalleryResponse & {
  data: PhotoResponse[]
  pagination: PaginatedResponse<PhotoResponse>['pagination']
}

export async function getGallery(
  slug: string,
  opts: { cursor?: string; limit?: number } = {}
): Promise<GalleryPageResponse> {
  const params = new URLSearchParams()
  if (opts.cursor) params.set('cursor', opts.cursor)
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.size ? `?${params}` : ''
  return apiFetch(`/api/v1/g/${slug}${qs}`)
}

// ─── Upload ─────────────────────────────────────────────────────────────────

export async function uploadFile(
  slug: string,
  file: File,
  guestName?: string
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  if (guestName) form.append('guestName', guestName)

  const res = await fetch(`${BASE_URL}/api/v1/g/${slug}/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body, `Upload failed: ${res.status}`)
  }
  return res.json()
}

// ─── Admin Auth ──────────────────────────────────────────────────────────────

export async function adminLogin(username: string, password: string): Promise<void> {
  await apiFetch('/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function adminLogout(): Promise<void> {
  await apiFetch('/api/v1/admin/logout', { method: 'POST' })
}

// ─── Setup ──────────────────────────────────────────────────────────────────

export type SetupStatusResponse = {
  setupRequired: boolean
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  return apiFetch('/api/v1/setup/status')
}

export async function submitSetup(data: {
  username: string
  password: string
  weddingName?: string
  galleryName?: string
}): Promise<void> {
  await apiFetch('/api/v1/setup', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ─── Admin Galleries ─────────────────────────────────────────────────────────

export async function getAdminGalleries(): Promise<
  Array<GalleryResponse & { weddingName: string; weddingSlug: string }>
> {
  const weddings = await apiFetch<WeddingResponse[]>('/api/v1/admin/galleries')
  return weddings.flatMap((w) =>
    w.galleries.map((g) => ({ ...g, weddingName: w.name, weddingSlug: w.slug }))
  )
}

export async function createGallery(data: {
  weddingName: string
  weddingSlug: string
  galleryName: string
  gallerySlug: string
  description?: string
  layout?: 'MASONRY' | 'GRID'
  allowGuestDownload?: boolean
  guestNameMode?: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
  moderationMode?: 'MANUAL' | 'AUTO'
}): Promise<GalleryResponse & { id: string; weddingId: string }> {
  return apiFetch('/api/v1/admin/galleries', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateGallery(
  id: string,
  data: Partial<Pick<
    GalleryResponse,
    'name' | 'description' | 'layout' | 'allowGuestDownload' | 'guestNameMode' | 'isActive'
  >> & {
    uploadWindows?: Array<Pick<UploadWindowResponse, 'start' | 'end'>>
  }
): Promise<GalleryResponse> {
  return apiFetch(`/api/v1/admin/galleries/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteGallery(id: string): Promise<void> {
  await apiFetch(`/api/v1/admin/galleries/${id}`, { method: 'DELETE' })
}

// ─── Admin Photos ────────────────────────────────────────────────────────────

export type AdminPhotoResponse = PhotoResponse & {
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
}

export async function getAdminPhotos(
  galleryId: string,
  opts: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; cursor?: string } = {}
): Promise<{ data: AdminPhotoResponse[]; pagination: { nextCursor: string | null; hasMore: boolean } }> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.cursor) params.set('cursor', opts.cursor)
  const qs = params.size ? `?${params}` : ''
  return apiFetch(`/api/v1/admin/galleries/${galleryId}/photos${qs}`)
}

export async function moderatePhoto(
  photoId: string,
  data: { status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }
): Promise<AdminPhotoResponse> {
  return apiFetch(`/api/v1/admin/photos/${photoId}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function batchModerate(data: {
  action: 'approve' | 'reject'
  photoIds: string[]
  rejectionReason?: string
}): Promise<{ processed: number; failed: string[] }> {
  return apiFetch('/api/v1/admin/photos/batch', { method: 'POST', body: JSON.stringify(data) })
}

export { ApiError }
