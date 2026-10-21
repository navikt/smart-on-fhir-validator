import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findIssuerConfig } from '#core/config/issuers'
import { MAX_DEBUG_BODY_BYTES } from '#core/debug/request'
import { SESSION_COOKIE_NAME } from '#core/session/session-cookie'
import type { ActiveSession } from '#core/smart/types'
import { createSessionStore, resetSessionStoreForTests } from '#core/storage/session-store'

import { POST } from './route'

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: undefined as string | undefined } }))

vi.mock('#core/config/issuers', () => ({ findIssuerConfig: vi.fn<typeof findIssuerConfig>(() => null) }))
vi.mock('next/headers', () => ({
    headers: async () =>
        new Headers({ 'x-forwarded-host': 'validator.example.com', 'x-forwarded-proto': 'https' }),
    cookies: async () => ({
        get: (name: string) =>
            name === SESSION_COOKIE_NAME && cookieValue.current ? { value: cookieValue.current } : undefined,
    }),
}))

const ORIGIN = 'https://validator.example.com'
const BASE = 'https://ehr.example.com/fhir'

const input = { method: 'GET', resourceType: 'Patient', id: '123', query: '', body: null, contentType: null }

function post(body: BodyInit, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest('http://localhost:3001/api/debug/fhir', {
        method: 'POST',
        body,
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    })
}

async function storeSession(): Promise<void> {
    const session: ActiveSession = {
        state: 'active',
        sessionId: 'session-1',
        fhirBaseUrl: BASE,
        clientId: 'client-1',
        requestedScope: 'openid',
        tokenResponse: { access_token: 'secret-access-token', token_type: 'Bearer', scope: 'openid' },
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        idTokenClaims: null,
        smartConfiguration: { issuer: 'https://ehr.example.com' },
        createdAt: new Date().toISOString(),
        exchanges: [],
        clientAuthMethod: 'none',
    }
    await (await createSessionStore()).set('session-1', session, 60)
}

beforeEach(async () => {
    cookieValue.current = 'session-1'
    await storeSession()
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ resourceType: 'Patient', id: '123' })),
    )
})

afterEach(() => {
    vi.unstubAllGlobals()
    resetSessionStoreForTests()
})

describe('POST /api/debug/fhir', () => {
    it.each([
        ['missing', undefined],
        ['foreign', 'https://evil.example.com'],
        ['same host over http', 'http://validator.example.com'],
    ])('rejects a %s Origin with 403', async (_name, origin) => {
        const request = post(JSON.stringify(input), origin ? { origin } : {})
        if (!origin) request.headers.delete('origin')

        const response = await POST(request)

        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ ok: false, error: 'cross_origin_request' })
        expect(fetch).not.toHaveBeenCalled()
    })

    it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx'])(
        'rejects %s with 415',
        async (contentType) => {
            const response = await POST(post(JSON.stringify(input), { 'content-type': contentType }))

            expect(response.status).toBe(415)
        },
    )

    it('accepts a charset parameter on the content type', async () => {
        const response = await POST(
            post(JSON.stringify(input), { 'content-type': 'application/json; charset=utf-8' }),
        )

        expect(response.status).toBe(200)
    })

    it('rejects a missing cookie with 401', async () => {
        cookieValue.current = undefined

        const response = await POST(post(JSON.stringify(input)))

        expect(response.status).toBe(401)
        expect(await response.json()).toMatchObject({ error: 'no_session' })
    })

    it('rejects an unknown session with 401', async () => {
        cookieValue.current = 'other'

        expect((await POST(post(JSON.stringify(input)))).status).toBe(401)
    })

    it('rejects malformed JSON with 400', async () => {
        const response = await POST(post('{'))

        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ error: 'invalid_json' })
    })

    it('rejects an invalid request with 400', async () => {
        const response = await POST(post(JSON.stringify({ ...input, id: '..' })))

        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ error: 'invalid_request' })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('rejects an advertised oversized Content-Length with 413', async () => {
        const response = await POST(post(JSON.stringify(input), { 'content-length': '999999999' }))

        expect(response.status).toBe(413)
        expect(await response.json()).toMatchObject({ error: 'request_too_large' })
    })

    it('rejects an oversized actual stream even without Content-Length', async () => {
        const chunk = new TextEncoder().encode('a'.repeat(1024 * 1024))
        let sent = 0
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent++ < 8) controller.enqueue(chunk)
                else controller.close()
            },
        })
        const request = new NextRequest('http://localhost:3001/api/debug/fhir', {
            method: 'POST',
            body: stream,
            headers: { origin: ORIGIN, 'content-type': 'application/json' },
            duplex: 'half',
        } as ConstructorParameters<typeof NextRequest>[1])

        const response = await POST(request)

        expect(response.status).toBe(413)
    })

    it('accepts a legal 1 MB body whose JSON escaping expands the envelope', async () => {
        const body = '"'.repeat(MAX_DEBUG_BODY_BYTES)
        const payload = JSON.stringify({
            ...input,
            method: 'POST',
            resourceType: 'Patient',
            id: '',
            body,
            contentType: 'application/fhir+json',
        })
        expect(payload.length).toBeGreaterThan(MAX_DEBUG_BODY_BYTES * 2)

        const response = await POST(post(payload))

        expect(response.status).toBe(200)
    })

    it('rejects a body over 1 MB with 400', async () => {
        const payload = JSON.stringify({
            ...input,
            method: 'POST',
            id: '',
            body: 'a'.repeat(MAX_DEBUG_BODY_BYTES + 1),
            contentType: 'application/fhir+json',
        })

        const response = await POST(post(payload))

        expect(response.status).toBe(400)
    })

    it('rejects an invalid custom token with 400 and no echo', async () => {
        const response = await POST(
            post(JSON.stringify({ ...input, authentication: 'custom', customToken: 'bad token' })),
        )

        expect(response.status).toBe(400)
        expect(JSON.stringify(await response.json())).not.toContain('bad token')
        expect(fetch).not.toHaveBeenCalled()
    })

    it('sends no Authorization header for none and the supplied token for custom', async () => {
        await POST(post(JSON.stringify({ ...input, authentication: 'none' })))
        expect(new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false)

        const response = await POST(
            post(JSON.stringify({ ...input, authentication: 'custom', customToken: 'custom-abc' })),
        )
        const text = JSON.stringify(await response.json())
        expect(new Headers(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
            'Bearer custom-abc',
        )
        expect(text).not.toContain('custom-abc')
    })

    it('proxies the call and returns the redacted exchange', async () => {
        const response = await POST(post(JSON.stringify(input)))
        const json = await response.json()

        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(json).toMatchObject({
            ok: true,
            bodyTruncated: false,
            exchange: { phase: 'debug', response: { status: 200, body: { resourceType: 'Patient' } } },
        })
        expect(JSON.stringify(json)).not.toContain('secret-access-token')
        expect(fetch).toHaveBeenCalledWith(
            `${BASE}/Patient/123`,
            expect.objectContaining({ redirect: 'manual' }),
        )
    })
})
