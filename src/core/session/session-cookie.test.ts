import { describe, expect, it } from 'vitest'

import {
    buildSessionCookie,
    createSessionId,
    parseSessionCookie,
    SESSION_COOKIE_NAME,
    serializeSessionCookie,
} from './session-cookie'

describe('createSessionId', () => {
    it('generates a URL-safe, non-empty identifier', () => {
        const id = createSessionId()
        expect(id.length).toBeGreaterThan(0)
        expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('generates a different id on every call', () => {
        const ids = new Set(Array.from({ length: 50 }, () => createSessionId()))
        expect(ids.size).toBe(50)
    })
})

describe('buildSessionCookie', () => {
    it('sets HttpOnly, Secure and SameSite=Lax, per the security requirements', () => {
        const attributes = buildSessionCookie('abc')

        expect(attributes.httpOnly).toBe(true)
        expect(attributes.secure).toBe(true)
        // Lax, not Strict: the EHR's authorization server redirects the browser back to
        // /callback cross-site, and a Strict cookie would not be sent on that navigation.
        expect(attributes.sameSite).toBe('lax')
        expect(attributes.path).toBe('/')
        expect(attributes.name).toBe(SESSION_COOKIE_NAME)
        expect(attributes.value).toBe('abc')
    })

    it('omits maxAge when not given', () => {
        expect(buildSessionCookie('abc').maxAge).toBeUndefined()
    })

    it('includes maxAge when given', () => {
        expect(buildSessionCookie('abc', 600).maxAge).toBe(600)
    })
})

describe('serializeSessionCookie', () => {
    it('produces a Set-Cookie value with all required attributes', () => {
        const header = serializeSessionCookie('abc123', 600)

        expect(header).toContain(`${SESSION_COOKIE_NAME}=abc123`)
        expect(header).toContain('Path=/')
        expect(header).toContain('HttpOnly')
        expect(header).toContain('Secure')
        expect(header).toContain('SameSite=Lax')
        expect(header).toContain('Max-Age=600')
    })

    it('omits Max-Age when no maxAgeSeconds is given (session cookie)', () => {
        expect(serializeSessionCookie('abc123')).not.toContain('Max-Age')
    })

    it('percent-encodes the session id value', () => {
        const header = serializeSessionCookie('a b/c')
        expect(header).toContain(`${SESSION_COOKIE_NAME}=${encodeURIComponent('a b/c')}`)
    })
})

describe('parseSessionCookie', () => {
    it('returns null for a missing header', () => {
        expect(parseSessionCookie(null)).toBeNull()
        expect(parseSessionCookie(undefined)).toBeNull()
        expect(parseSessionCookie('')).toBeNull()
    })

    it('extracts the session cookie among unrelated cookies', () => {
        const header = `other=1; ${SESSION_COOKIE_NAME}=abc123; another=2`
        expect(parseSessionCookie(header)).toBe('abc123')
    })

    it('extracts the session cookie when it is the only cookie present', () => {
        expect(parseSessionCookie(`${SESSION_COOKIE_NAME}=abc123`)).toBe('abc123')
    })

    it('returns null when the session cookie is absent', () => {
        expect(parseSessionCookie('other=1; another=2')).toBeNull()
    })

    it('decodes a percent-encoded value', () => {
        const header = `${SESSION_COOKIE_NAME}=${encodeURIComponent('a b/c')}`
        expect(parseSessionCookie(header)).toBe('a b/c')
    })

    it('round-trips through serializeSessionCookie', () => {
        const header = serializeSessionCookie('a-real-session-id-123')
        expect(parseSessionCookie(header)).toBe('a-real-session-id-123')
    })

    it('tolerates whitespace around cookie pairs', () => {
        const header = `  other=1 ;  ${SESSION_COOKIE_NAME}=abc123  ; another=2`
        expect(parseSessionCookie(header)).toBe('abc123')
    })
})
