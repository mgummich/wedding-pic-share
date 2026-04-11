import { notFound } from 'next/navigation'
import { getGallery, ApiError } from '@/lib/api'
import { GalleryClient } from './GalleryClient'
import { GuestNav } from '@/components/GuestNav'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params
  try {
    const gallery = await getGallery(slug)
    return { title: gallery.name }
  } catch {
    return { title: 'Galerie nicht gefunden' }
  }
}

export default async function GalleryPage({ params }: PageProps) {
  const { slug } = await params

  let galleryData: Awaited<ReturnType<typeof getGallery>>
  try {
    galleryData = await getGallery(slug)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <GuestNav gallerySlug={slug} galleryName={galleryData.name} />

      <div className="px-4 pt-6 pb-3">
        {galleryData.description && (
          <p className="text-text-muted">{galleryData.description}</p>
        )}
        <p className="text-text-muted text-sm mt-1">{galleryData.photoCount} Fotos</p>
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
