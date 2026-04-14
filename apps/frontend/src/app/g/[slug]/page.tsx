import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getGallery } from '@/lib/api'
import { normalizeAdminLocale, translateAdminMessage } from '@/lib/adminI18n'
import { GalleryClient } from './GalleryClient'
import { GuestNav } from '@/components/GuestNav'

interface PageProps {
  params: Promise<{ slug: string }>
}

async function getServerLocale() {
  try {
    const cookieStore = await cookies()
    return normalizeAdminLocale(cookieStore.get('NEXT_LOCALE')?.value)
  } catch {
    return 'de' as const
  }
}

function hasStatus(error: unknown, status: number): boolean {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === status
}

export async function generateMetadata({ params }: PageProps) {
  const locale = await getServerLocale()
  const { slug } = await params
  try {
    const gallery = await getGallery(slug)
    return { title: gallery.name }
  } catch {
    return { title: translateAdminMessage(locale, 'guest.gallery.notFoundTitle') }
  }
}

export default async function GalleryPage({ params }: PageProps) {
  const locale = await getServerLocale()
  const t = (key: Parameters<typeof translateAdminMessage>[1], params: Record<string, string | number> = {}) =>
    translateAdminMessage(locale, key, params)
  const { slug } = await params

  let galleryData: Awaited<ReturnType<typeof getGallery>>
  try {
    galleryData = await getGallery(slug)
  } catch (err) {
    if (hasStatus(err, 404)) notFound()
    if (hasStatus(err, 401)) {
      redirect(`/g/${slug}/unlock?next=${encodeURIComponent(`/g/${slug}`)}`)
      return null
    }
    throw err
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <GuestNav gallerySlug={slug} galleryName={galleryData.name} />

      <div className="px-4 pt-6 pb-3">
        {galleryData.description && (
          <p className="text-text-muted">{galleryData.description}</p>
        )}
        <p className="text-text-muted text-sm mt-1">{t('guest.gallery.photoCount', { count: galleryData.photoCount })}</p>
      </div>

      <div className="px-2 pb-32">
        <GalleryClient
          gallery={galleryData}
          initialPhotos={galleryData.data}
          initialCursor={galleryData.pagination.nextCursor}
          initialHasMore={galleryData.pagination.hasMore}
        />
      </div>
    </main>
  )
}
