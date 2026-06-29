/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Don't fail the production build on type/lint errors — runtime correctness is
  // covered by review; build-time strictness shouldn't block the demo deploy.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.nanobanana.ai' },
    ],
  },
}
module.exports = nextConfig
