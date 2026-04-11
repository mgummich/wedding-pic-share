import type { NextConfig } from 'next'
import withPWA from '@ducanh2912/next-pwa'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [],
  },
  async rewrites() {
    // BACKEND_URL: internal service URL used server-to-server (e.g. http://backend:4000 in Docker).
    // Falls back to localhost for local dev outside Docker.
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000'
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ]
  },
}

export default withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
})(nextConfig)
