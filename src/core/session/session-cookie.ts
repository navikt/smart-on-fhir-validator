import { randomBytes } from 'node:crypto'

/**
 * `next/headers` is only ever imported dynamically, inside the functions that need it, so the
 * pure cookie logic above it stays unit-testable with plain strings.
 */

export const SESSION_COOKIE_NAME = 'smart-validator-session'

const SESSION_ID_BYTES = 32

export function createSessionId(): string {
    return randomBytes(SESSION_ID_BYTES).toString('base64url')
}

export type SessionCookieAttributes = {
    name: string
    value: string
    httpOnly: true
    /**
     * Must be `true` whenever the app is served over HTTPS and `false` for plain-HTTP local
     * development: a `Secure` cookie set over `http://` is silently dropped, breaking every launch.
     */
    secure: boolean
    /**
     * Must be `Lax`, not `Strict`: the EHR's authorization server redirects the browser back to
     * `/callback` cross-site after login, and a `Strict` cookie is not sent on that top-level
     * cross-site navigation: the session would be unreadable at the one moment it matters most.
     */
    sameSite: 'lax'
    path: '/'
    maxAge?: number
}

export function buildSessionCookie(
    sessionId: string,
    secure: boolean,
    maxAgeSeconds?: number,
): SessionCookieAttributes {
    return {
        name: SESSION_COOKIE_NAME,
        value: sessionId,
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
    }
}

export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
    if (!cookieHeader) return null

    for (const part of cookieHeader.split(';')) {
        const separatorIndex = part.indexOf('=')
        if (separatorIndex === -1) continue

        const name = part.slice(0, separatorIndex).trim()
        if (name !== SESSION_COOKIE_NAME) continue

        const value = part.slice(separatorIndex + 1).trim()
        try {
            return decodeURIComponent(value)
        } catch {
            return value
        }
    }

    return null
}

export function serializeSessionCookie(sessionId: string, secure: boolean, maxAgeSeconds?: number): string {
    const attributes = buildSessionCookie(sessionId, secure, maxAgeSeconds)
    const parts = [
        `${attributes.name}=${encodeURIComponent(attributes.value)}`,
        `Path=${attributes.path}`,
        'HttpOnly',
        ...(attributes.secure ? ['Secure'] : []),
        `SameSite=Lax`,
    ]
    if (attributes.maxAge !== undefined) parts.push(`Max-Age=${attributes.maxAge}`)

    return parts.join('; ')
}

export async function readSessionIdFromCookies(): Promise<string | null> {
    const { cookies } = await import('next/headers')
    const store = await cookies()
    return store.get(SESSION_COOKIE_NAME)?.value ?? null
}

/**
 * Whether the current request arrived over HTTPS. Trusts `x-forwarded-proto` first (nais's
 * ingress terminates TLS), then treats `localhost` as the only genuine plain-HTTP case. Never
 * keyed off `NODE_ENV`: this attribute is a real security boundary, not a convenience.
 */
async function isRequestSecure(): Promise<boolean> {
    const { headers } = await import('next/headers')
    const requestHeaders = await headers()
    const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3001'
    const protocol =
        requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

    return protocol === 'https'
}

export async function writeSessionCookie(sessionId: string, maxAgeSeconds?: number): Promise<void> {
    const { cookies } = await import('next/headers')
    const store = await cookies()
    const secure = await isRequestSecure()
    const attributes = buildSessionCookie(sessionId, secure, maxAgeSeconds)
    store.set(attributes.name, attributes.value, {
        httpOnly: attributes.httpOnly,
        secure: attributes.secure,
        sameSite: attributes.sameSite,
        path: attributes.path,
        maxAge: attributes.maxAge,
    })
}
