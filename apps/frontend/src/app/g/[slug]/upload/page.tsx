import { notFound } from 'next/navigation'
import { getGallery, ApiError } from '@/lib/api'
import { UploadForm } from './UploadForm'
import { GuestNav } from '@/components/GuestNav'
import { EmptyState } from '@/components/EmptyState'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function UploadPage({ params }: PageProps) {
  const { slug } = await params

  let gallery: Awaited<ReturnType<typeof getGallery>>
  try {
    gallery = await getGallery(slug)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  return (
    <main className="min-h-screen bg-surface-base max-w-lg mx-auto">
      <GuestNav gallerySlug={slug} galleryName={gallery.name} />
      <div className="px-4 pt-4">
        <h1 className="font-display text-xl text-text-primary mb-1">Fotos hochladen</h1>
      </div>
      {gallery.isUploadOpen ? (
        <UploadForm gallerySlug={slug} guestNameMode={gallery.guestNameMode} />
      ) : (
        <EmptyState
          title="Uploads sind zur Zeit geschlossen"
          description="Bitte versuche es spaeter erneut oder nutze ein freigegebenes Upload-Zeitfenster."
        />
      )}
    </main>
  )
}
