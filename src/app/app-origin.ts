import { headers } from 'next/headers'

/**
 * This deployment's own public origin, derived from the incoming request's headers.
 *
 * Deliberately not `NextRequest.nextUrl.origin`: under `output: 'standalone'`, which is how the
 * Dockerfile runs this app, that reflects the server's own bind address (`HOSTNAME`/`PORT`) rather
 * than the host the client used — so it yields `http://0.0.0.0:3000` in production and every URL
 * built from it, including the OAuth `redirect_uri`, is wrong.
 *
 * The `x-forwarded-*` fallback mirrors `isRequestSecure` in `#core/session/session-cookie`, since
 * nais's ingress terminates TLS and forwards plain HTTP to the app.
 */
export async function getAppOrigin(): Promise<string> {
    const requestHeaders = await headers()
    const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000'
    const protocol =
        requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

    return `${protocol}://${host}`
}
