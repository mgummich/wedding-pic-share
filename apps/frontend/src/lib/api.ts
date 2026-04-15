import type {
  GalleryResponse,
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
const ADMIN_CSRF_PATH = '/api/v1/admin/csrf'
let adminCsrfToken: string | null = null
let adminCsrfTokenInFlight: Promise<string> | null = null

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string
  ) {
    super(message)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertPhotoResponse(value: unknown, context: string): asserts value is PhotoResponse {
  if (!isObject(value)) throw new Error(`${context}: expected object`)
  if (typeof value.id !== 'string') throw new Error(`${context}: invalid id`)
  if (value.mediaType !== 'IMAGE' && value.mediaType !== 'VIDEO') throw new Error(`${context}: invalid mediaType`)
  if (typeof value.thumbUrl !== 'string') throw new Error(`${context}: invalid thumbUrl`)
  if (typeof value.displayUrl !== 'string') throw new Error(`${context}: invalid displayUrl`)
  if (!(typeof value.duration === 'number' || value.duration === null)) throw new Error(`${context}: invalid duration`)
  if (!(typeof value.guestName === 'string' || value.guestName === null)) throw new Error(`${context}: invalid guestName`)
  if (typeof value.createdAt !== 'string') throw new Error(`${context}: invalid createdAt`)
}

function assertUploadWindowResponse(value: unknown, context: string): asserts value is UploadWindowResponse {
  if (!isObject(value)) throw new Error(`${context}: expected object`)
  if (typeof value.id !== 'string') throw new Error(`${context}: invalid id`)
  if (typeof value.start !== 'string') throw new Error(`${context}: invalid start`)
  if (typeof value.end !== 'string') throw new Error(`${context}: invalid end`)
  if (typeof value.createdAt !== 'string') throw new Error(`${context}: invalid createdAt`)
}

function assertGalleryResponse(value: unknown, context: string): asserts value is GalleryResponse {
  if (!isObject(value)) throw new Error(`${context}: expected object`)
  if (typeof value.id !== 'string') throw new Error(`${context}: invalid id`)
  if (typeof value.name !== 'string') throw new Error(`${context}: invalid name`)
  if (typeof value.slug !== 'string') throw new Error(`${context}: invalid slug`)
  if (!(typeof value.description === 'string' || value.description === null)) {
    throw new Error(`${context}: invalid description`)
  }
  if (value.layout !== 'MASONRY' && value.layout !== 'GRID') throw new Error(`${context}: invalid layout`)
  if (typeof value.allowGuestDownload !== 'boolean') throw new Error(`${context}: invalid allowGuestDownload`)
  if (!['OPTIONAL', 'REQUIRED', 'HIDDEN'].includes(String(value.guestNameMode))) {
    throw new Error(`${context}: invalid guestNameMode`)
  }
  if (typeof value.stripExif !== 'boolean') throw new Error(`${context}: invalid stripExif`)
  if (typeof value.photoCount !== 'number') throw new Error(`${context}: invalid photoCount`)
  if (typeof value.isActive !== 'boolean') throw new Error(`${context}: invalid isActive`)
  if (typeof value.isArchived !== 'boolean') throw new Error(`${context}: invalid isArchived`)
  if (!(typeof value.archivedAt === 'string' || value.archivedAt === null)) throw new Error(`${context}: invalid archivedAt`)
  if (!(typeof value.archiveSizeBytes === 'number' || value.archiveSizeBytes === null)) {
    throw new Error(`${context}: invalid archiveSizeBytes`)
  }
  if (value.archiveStatus !== undefined && !['IDLE', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(String(value.archiveStatus))) {
    throw new Error(`${context}: invalid archiveStatus`)
  }
  if (value.archiveError !== undefined && !(typeof value.archiveError === 'string' || value.archiveError === null)) {
    throw new Error(`${context}: invalid archiveError`)
  }
  if (value.archiveRequestedAt !== undefined && !(typeof value.archiveRequestedAt === 'string' || value.archiveRequestedAt === null)) {
    throw new Error(`${context}: invalid archiveRequestedAt`)
  }
  if (typeof value.isUploadOpen !== 'boolean') throw new Error(`${context}: invalid isUploadOpen`)
  if (typeof value.uploadWindowsVersion !== 'string') throw new Error(`${context}: invalid uploadWindowsVersion`)
  if (!Array.isArray(value.uploadWindows)) throw new Error(`${context}: invalid uploadWindows`)
  for (let i = 0; i < value.uploadWindows.length; i += 1) {
    assertUploadWindowResponse(value.uploadWindows[i], `${context}.uploadWindows[${i}]`)
  }
}

function isAdminMutation(path: string, method: string): boolean {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return false
  if (!path.startsWith('/api/v1/admin/')) return false
  return path !== '/api/v1/admin/login' && path !== ADMIN_CSRF_PATH
}

async function fetchAdminCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && adminCsrfToken) {
    return adminCsrfToken
  }
  if (!forceRefresh && adminCsrfTokenInFlight) {
    return adminCsrfTokenInFlight
  }

  adminCsrfTokenInFlight = (async () => {
    const res = await fetch(`${BASE_URL}${ADMIN_CSRF_PATH}`, {
      method: 'GET',
      credentials: 'include',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(res.status, body, `${res.status}`)
    }
    const body = await res.json() as { csrfToken?: unknown }
    if (typeof body.csrfToken !== 'string' || body.csrfToken.length < 8) {
      throw new Error('Invalid CSRF token response')
    }
    adminCsrfToken = body.csrfToken
    return body.csrfToken
  })()

  try {
    return await adminCsrfTokenInFlight
  } finally {
    adminCsrfTokenInFlight = null
  }
}

async function apiFetch<T>(path: string, init?: RequestInit, retryCsrf = true): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const requiresCsrf = isAdminMutation(path, method)
  const csrfHeaders: Record<string, string> = {}
  if (requiresCsrf) {
    const token = await fetchAdminCsrfToken()
    csrfHeaders['x-csrf-token'] = token
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...csrfHeaders,
      ...init?.headers,
    },
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (requiresCsrf && retryCsrf && res.status === 403) {
      await fetchAdminCsrfToken(true)
      return apiFetch<T>(path, init, false)
    }
    throw new ApiError(res.status, body, `${res.status}`)
  }
  return res.json()
}

async function apiFetchBlob(path: string, init?: RequestInit, retryCsrf = true): Promise<Blob> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const requiresCsrf = isAdminMutation(path, method)
  const csrfHeaders: Record<string, string> = {}
  if (requiresCsrf) {
    const token = await fetchAdminCsrfToken()
    csrfHeaders['x-csrf-token'] = token
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...csrfHeaders,
      ...init?.headers,
    },
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (requiresCsrf && retryCsrf && res.status === 403) {
      await fetchAdminCsrfToken(true)
      return apiFetchBlob(path, init, false)
    }
    throw new ApiError(res.status, body, `${res.status}`)
  }
  return res.blob()
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
  const payload = await apiFetch<unknown>(`/api/v1/g/${slug}${qs}`)
  if (!isObject(payload)) {
    throw new Error('getGallery: expected object response')
  }
  assertGalleryResponse(payload, 'getGallery')
  if (!Array.isArray(payload.data)) {
    throw new Error('getGallery: invalid data')
  }
  for (let i = 0; i < payload.data.length; i += 1) {
    assertPhotoResponse(payload.data[i], `getGallery.data[${i}]`)
  }
  if (!isObject(payload.pagination)) {
    throw new Error('getGallery: invalid pagination')
  }
  if (!(typeof payload.pagination.nextCursor === 'string' || payload.pagination.nextCursor === null)) {
    throw new Error('getGallery: invalid nextCursor')
  }
  if (typeof payload.pagination.hasMore !== 'boolean') {
    throw new Error('getGallery: invalid hasMore')
  }
  return payload as unknown as GalleryPageResponse
}

// ─── Upload ─────────────────────────────────────────────────────────────────

export async function uploadFile(
  slug: string,
  file: File,
  guestName?: string
): Promise<UploadResponse> {
  return uploadMultipart(`/api/v1/g/${slug}/upload`, file, guestName)
}

export async function deletePendingUpload(
  slug: string,
  photoId: string,
  deleteToken: string
): Promise<void> {
  await apiFetch(`/api/v1/g/${slug}/uploads/${photoId}`, {
    method: 'DELETE',
    body: JSON.stringify({ deleteToken }),
  })
}

export async function verifyGalleryAccess(
  slug: string,
  secretKey: string
): Promise<{ ok: true }> {
  return apiFetch(`/api/v1/g/${slug}/access`, {
    method: 'POST',
    body: JSON.stringify({ secretKey }),
  })
}

export async function adminUploadFile(
  galleryId: string,
  file: File,
  guestName?: string,
  opts?: { autoApprove?: boolean }
): Promise<UploadResponse> {
  const params = new URLSearchParams()
  if (opts?.autoApprove) {
    params.set('mode', 'photographer')
  }
  const qs = params.size ? `?${params}` : ''
  return uploadMultipart(`/api/v1/admin/galleries/${galleryId}/upload${qs}`, file, guestName)
}

async function uploadMultipart(
  path: string,
  file: File,
  guestName?: string,
  retryCsrf = true
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  if (guestName) form.append('guestName', guestName)

  const headers: Record<string, string> = {}
  if (isAdminMutation(path, 'POST')) {
    headers['x-csrf-token'] = await fetchAdminCsrfToken()
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: form,
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (isAdminMutation(path, 'POST') && retryCsrf && res.status === 403) {
      await fetchAdminCsrfToken(true)
      return uploadMultipart(path, file, guestName, false)
    }
    throw new ApiError(res.status, body, `Upload failed: ${res.status}`)
  }
  return res.json()
}

// ─── Admin Auth ──────────────────────────────────────────────────────────────

export async function adminLogin(username: string, password: string, totpCode?: string): Promise<void> {
  adminCsrfToken = null
  const payload: { username: string; password: string; totpCode?: string } = { username, password }
  if (totpCode) {
    payload.totpCode = totpCode
  }
  await apiFetch('/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminLogout(): Promise<void> {
  adminCsrfToken = null
  await apiFetch('/api/v1/admin/logout', { method: 'POST' })
}

export type AdminTwoFactorStatusResponse = {
  enabled: boolean
  configured: boolean
}

export async function getAdminTwoFactorStatus(): Promise<AdminTwoFactorStatusResponse> {
  return apiFetch('/api/v1/admin/2fa/status')
}

export async function setupAdminTwoFactor(password: string): Promise<{
  secret: string
  setupToken: string
  otpauthUrl: string
}> {
  return apiFetch('/api/v1/admin/2fa/setup', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export async function verifyAdminTwoFactor(code: string, setupToken: string): Promise<void> {
  await apiFetch('/api/v1/admin/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ code, setupToken }),
  })
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
  setupToken: string
  weddingName?: string
  galleryName?: string
}): Promise<void> {
  const { setupToken, ...body } = data
  await apiFetch('/api/v1/setup', {
    method: 'POST',
    headers: {
      'x-setup-token': setupToken,
    },
    body: JSON.stringify(body),
  })
}

// ─── Admin Galleries ─────────────────────────────────────────────────────────

export async function getAdminGalleries(): Promise<
  Array<GalleryResponse & { weddingName: string; weddingSlug: string }>
> {
  const weddings = await apiFetch<unknown>('/api/v1/admin/galleries')
  if (!Array.isArray(weddings)) {
    throw new Error('getAdminGalleries: expected array response')
  }
  for (let i = 0; i < weddings.length; i += 1) {
    const wedding = weddings[i]
    if (!isObject(wedding)) throw new Error(`getAdminGalleries[${i}]: expected object`)
    if (typeof wedding.name !== 'string') throw new Error(`getAdminGalleries[${i}]: invalid wedding name`)
    if (typeof wedding.slug !== 'string') throw new Error(`getAdminGalleries[${i}]: invalid wedding slug`)
    if (!Array.isArray(wedding.galleries)) throw new Error(`getAdminGalleries[${i}]: invalid galleries`)
    for (let j = 0; j < wedding.galleries.length; j += 1) {
      assertGalleryResponse(wedding.galleries[j], `getAdminGalleries[${i}].galleries[${j}]`)
    }
  }
  const typedWeddings = weddings as Array<{ name: string; slug: string; galleries: GalleryResponse[] }>
  return typedWeddings.flatMap((w) =>
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
  secretKey?: string
}): Promise<GalleryResponse & { id: string; weddingId: string }> {
  const payload = await apiFetch<unknown>('/api/v1/admin/galleries', { method: 'POST', body: JSON.stringify(data) })
  assertGalleryResponse(payload, 'createGallery')
  if (!isObject(payload)) {
    throw new Error('createGallery: expected object')
  }
  if (typeof payload.weddingId !== 'string') {
    throw new Error('createGallery: invalid weddingId')
  }
  return payload as unknown as GalleryResponse & { id: string; weddingId: string }
}

export async function updateGallery(
  id: string,
  data:
    & Partial<Pick<
      GalleryResponse,
      'name' | 'description' | 'layout' | 'allowGuestDownload' | 'guestNameMode' | 'stripExif' | 'isActive'
    >>
    & {
      secretKey?: string | null
    }
    & (
      | {
        uploadWindows?: undefined
        uploadWindowsVersion?: string
      }
      | {
        uploadWindows: Array<Pick<UploadWindowResponse, 'start' | 'end'>>
        uploadWindowsVersion: string
      }
    )
): Promise<GalleryResponse> {
  const payload = await apiFetch<unknown>(`/api/v1/admin/galleries/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  assertGalleryResponse(payload, 'updateGallery')
  return payload
}

export async function deleteGallery(id: string): Promise<void> {
  await apiFetch(`/api/v1/admin/galleries/${id}`, { method: 'DELETE' })
}

export async function archiveGallery(id: string): Promise<GalleryResponse> {
  const payload = await apiFetch<unknown>(`/api/v1/admin/galleries/${id}/archive`, { method: 'POST' })
  assertGalleryResponse(payload, 'archiveGallery')
  return payload
}

export async function exportGallery(id: string): Promise<Blob> {
  return apiFetchBlob(`/api/v1/admin/galleries/${id}/export`)
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

export function __resetApiClientStateForTests(): void {
  adminCsrfToken = null
  adminCsrfTokenInFlight = null
}
