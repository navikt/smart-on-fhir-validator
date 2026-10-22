import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_DEBUG_BODY_BYTES } from '#core/debug/request'
import { SESSION_COOKIE_NAME } from '#core/session/session-cookie'
import type { ActiveSession, PendingSession } from '#core/smart/types'
import { createSessionStore, resetSessionStoreForTests } from '#core/storage/session-store'

import { GET } from './route'

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: undefined as string | undefined } }))

vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) =>
            name === SESSION_COOKIE_NAME && cookieValue.current ? { value: cookieValue.current } : undefined,
    }),
}))

const BASE = 'https://ehr.example.com/fhir'

const statement = {
    resourceType: 'CapabilityStatement',
    fhirVersion: '4.0.1',
    software: { name: 'secret-internal-name' },
    rest: [
        {
            resource: [
                {
                    type: 'Patient',
                    interaction: [{ code: 'read' }],
                    searchParam: [{ name: 'name', type: 'string' }],
                    operation: [{ name: 'everything' }],
                },
            ],
        },
    ],
}

async function store(state: 'active' | 'pending'): Promise<void> {
    const session = {
        state,
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
    } as unknown as ActiveSession | PendingSession
    await (await createSessionStore()).set('session-1', session, 60)
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
    cookieValue.current = 'session-1'
    fetchMock = vi.fn<typeof fetch>(async () => Response.json(statement))
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
    resetSessionStoreForTests()
})

describe('GET /api/debug/capabilities', () => {
    it('returns 401 without a cookie and does not fetch', async () => {
        cookieValue.current = undefined
        await store('active')

        const response = await GET()

        expect(response.status).toBe(401)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 401 for a pending session and does not fetch', async () => {
        await store('pending')

        const response = await GET()

        expect(response.status).toBe(401)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 401 for an unknown session and does not fetch', async () => {
        const response = await GET()

        expect(response.status).toBe(401)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns the summary for an active session without leaking tokens or the raw document', async () => {
        await store('active')

        const response = await GET()
        const text = await response.text()

        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(JSON.parse(text)).toEqual({
            ok: true,
            capabilities: {
                fhirVersion: '4.0.1',
                resources: [
                    {
                        type: 'Patient',
                        interactions: ['read'],
                        searchParams: [{ name: 'name', type: 'string' }],
                        operations: ['everything'],
                    },
                ],
            },
        })
        expect(text).not.toContain('secret-access-token')
        expect(text).not.toContain('secret-internal-name')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${BASE}/metadata`)
    })

    it('returns a non-success error when the server fails', async () => {
        await store('active')
        fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))

        const response = await GET()

        expect(response.status).toBe(502)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.json()).toMatchObject({ ok: false, error: 'capability_statement_unavailable' })
    })

    it('does not follow a redirect from /metadata', async () => {
        await store('active')
        fetchMock.mockResolvedValue(
            new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/metadata' } }),
        )

        const response = await GET()

        expect(response.status).toBe(502)
        expect(await response.json()).toMatchObject({ ok: false, error: 'capability_statement_unavailable' })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
    })

    it('returns a non-success error when the response is truncated', async () => {
        await store('active')
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ pad: 'x'.repeat(MAX_DEBUG_BODY_BYTES + 10) }), {
                headers: { 'content-type': 'application/fhir+json' },
            }),
        )

        const response = await GET()

        expect(response.status).toBe(502)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.json()).toMatchObject({ ok: false, error: 'capability_statement_too_large' })
    })
})
