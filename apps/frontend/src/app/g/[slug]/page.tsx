import { notFound } from 'next/navigation'
import { getGallery, ApiError } from '@/lib/api'
import { GalleryClient } from './GalleryClient'

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
      <header className="px-4 pt-8 pb-6">
        <h1 className="font-display text-3xl text-text-primary">{galleryData.name}</h1>
        {galleryData.description && (
          <p className="text-text-muted mt-1">{galleryData.description}</p>
        )}
        <p className="text-text-muted text-sm mt-1">{galleryData.photoCount} Fotos</p>
      </header>

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
