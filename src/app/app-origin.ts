import { headers } from 'next/headers'

/**
 * This deployment's own public origin, derived from the incoming request's `Host` header.
 * Route handlers can read this straight off `NextRequest.nextUrl.origin`; Server Components have
 * no `Request` object, so they go through `next/headers` instead. Mirrors the same derivation
 * `src/app/api/mocks/fhir/[[...path]]/route.ts` uses for its own base URL.
 */
export async function getAppOrigin(): Promise<string> {
    const requestHeaders = await headers()
    const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000'
    const protocol =
        requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

    return `${protocol}://${host}`
}
