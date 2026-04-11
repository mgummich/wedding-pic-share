import { notFound } from 'next/navigation'
import { getGallery, ApiError } from '@/lib/api'
import { UploadForm } from './UploadForm'
import { GuestNav } from '@/components/GuestNav'

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
      <UploadForm gallerySlug={slug} guestNameMode={gallery.guestNameMode} />
    </main>
  )
}
