import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    output: 'standalone',
    reactStrictMode: true,
    serverExternalPackages: ['pino', 'next-logger'],
    logging: { fetches: { fullUrl: true } },
}

export default nextConfig
