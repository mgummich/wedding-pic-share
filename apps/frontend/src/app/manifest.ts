import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wedding Pic Share',
    short_name: 'WedPics',
    description: 'Teile deine schönsten Hochzeitsmomente',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAF7F4',
    theme_color: '#C4956A',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    categories: ['photo', 'social'],
  }
}
