import { headers } from 'next/headers'

/**
 * This deployment's own public origin, derived from the incoming request's headers.
 *
 * Deliberately not `NextRequest.nextUrl.origin`: under `output: 'standalone'` that reflects the
 * server's bind address, yielding `http://0.0.0.0:3000` in production, which would make the
 * OAuth `redirect_uri` wrong for every launch.
 */
export async function getAppOrigin(): Promise<string> {
    const requestHeaders = await headers()
    const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3001'
    const protocol =
        requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

    return `${protocol}://${host}`
}
