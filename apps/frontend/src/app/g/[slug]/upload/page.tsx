import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getGallery } from '@/lib/api'
import { normalizeAdminLocale, translateAdminMessage } from '@/lib/adminI18n'
import { UploadForm } from './UploadForm'
import { GuestNav } from '@/components/GuestNav'
import { EmptyState } from '@/components/EmptyState'

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

export default async function UploadPage({ params }: PageProps) {
  const locale = await getServerLocale()
  const t = (key: Parameters<typeof translateAdminMessage>[1], options: Record<string, string | number> = {}) =>
    translateAdminMessage(locale, key, options)
  const { slug } = await params

  let gallery: Awaited<ReturnType<typeof getGallery>>
  try {
    gallery = await getGallery(slug)
  } catch (err) {
    if (hasStatus(err, 404)) notFound()
    if (hasStatus(err, 401)) {
      redirect(`/g/${slug}/unlock?next=${encodeURIComponent(`/g/${slug}/upload`)}`)
      return null
    }
    throw err
  }

  return (
    <main className="min-h-screen bg-surface-base max-w-lg mx-auto">
      <GuestNav gallerySlug={slug} galleryName={gallery.name} />
      <div className="px-4 pt-4">
        <h1 className="font-display text-xl text-text-primary mb-1">{t('guest.uploadPage.title')}</h1>
      </div>
      {gallery.isUploadOpen ? (
        <UploadForm gallerySlug={slug} guestNameMode={gallery.guestNameMode} />
      ) : (
        <EmptyState
          title={t('guest.uploadPage.closedTitle')}
          description={t('guest.uploadPage.closedDescription')}
        />
      )}
    </main>
  )
}
