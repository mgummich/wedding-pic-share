import { notFound } from 'next/navigation'
import { getGallery, ApiError } from '@/lib/api'
import { UploadForm } from './UploadForm.js'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

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
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link href={`/g/${slug}`} className="text-text-muted hover:text-accent transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="font-display text-xl text-text-primary">{gallery.name}</h1>
          <p className="text-sm text-text-muted">Fotos hochladen</p>
        </div>
      </header>

      <UploadForm gallerySlug={slug} guestNameMode={gallery.guestNameMode} />
    </main>
  )
}
