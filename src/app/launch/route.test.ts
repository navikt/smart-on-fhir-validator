import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findIssuerConfig } from '#core/config/issuers'
import { SESSION_COOKIE_NAME } from '#core/session/session-cookie'
import { resetSessionStoreForTests } from '#core/storage/session-store'

import { GET } from './route'

const { setCookie } = vi.hoisted(() => ({
    setCookie: vi.fn<(name: string, value: string, options: Record<string, unknown>) => void>(),
}))

vi.mock('#core/config/issuers', () => ({ findIssuerConfig: vi.fn<typeof findIssuerConfig>() }))
vi.mock('next/headers', () => ({
    headers: async () =>
        new Headers({
            'x-forwarded-host': 'validator.example.com',
            'x-forwarded-proto': 'https',
        }),
    cookies: async () => ({ set: setCookie }),
}))

const FHIR_BASE_URL = 'https://epj.example.com/fhir'
const AUTHORIZATION_ENDPOINT = 'https://epj.example.com/oidc/authorize'

function request(query = ''): NextRequest {
    return new NextRequest(`http://localhost:3001/launch${query}`)
}

function redirectLocation(response: Response): URL {
    expect(response.status).toBe(307)
    return new URL(response.headers.get('location') ?? '')
}

beforeEach(() => {
    vi.mocked(findIssuerConfig).mockReturnValue(null)
    vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
            Response.json({
                issuer: 'https://epj.example.com/oidc',
                authorization_endpoint: AUTHORIZATION_ENDPOINT,
                token_endpoint: 'https://epj.example.com/oidc/token',
            }),
        ),
    )
})

afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    resetSessionStoreForTests()
})

describe('GET /launch', () => {
    it.each([
        ['', 'missing_iss'],
        ['?iss=invalid&launch=test-launch', 'invalid_iss'],
    ])('redirects invalid launch input %s to an actionable error', async (query, error) => {
        const location = redirectLocation(await GET(request(query)))

        expect(location.origin).toBe('https://validator.example.com')
        expect(location.pathname).toBe('/launch/error')
        expect(location.searchParams.get('error')).toBe(error)
        expect(setCookie).not.toHaveBeenCalled()
    })

    it('reports missing static registration when discovery advertises no dynamic registration', async () => {
        const location = redirectLocation(
            await GET(request(`?iss=${encodeURIComponent(FHIR_BASE_URL)}&launch=test-launch`)),
        )

        expect(location.pathname).toBe('/launch/error')
        expect(location.searchParams.get('error')).toBe('no_client_configuration')
        expect(location.searchParams.get('detail')).toContain(FHIR_BASE_URL)
        expect(setCookie).not.toHaveBeenCalled()
    })

    it('reports a discovery transport failure without an unhandled 500', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('Synthetic connection failure')
            }),
        )

        const location = redirectLocation(
            await GET(request(`?iss=${encodeURIComponent(FHIR_BASE_URL)}&launch=test-launch`)),
        )

        expect(location.pathname).toBe('/launch/error')
        expect(location.searchParams.get('error')).toBe(
            'Failed to reach the well-known SMART configuration endpoint',
        )
        expect(location.searchParams.get('detail')).toBe('Synthetic connection failure')
        expect(setCookie).not.toHaveBeenCalled()
    })

    it('launches the static asymmetric client with the FHIR audience and registered callback', async () => {
        vi.mocked(findIssuerConfig).mockReturnValue({
            fhirBaseUrl: FHIR_BASE_URL,
            clientId: 'NAV_SMART_on_FHIR_validator',
            auth: {
                type: 'confidential-asymmetric',
                privateKeyJwk: '{}',
                keyId: 'test-key',
                algorithm: 'ES384',
            },
            dynamicallyRegistered: false,
        })

        const location = redirectLocation(
            await GET(request(`?iss=${encodeURIComponent(FHIR_BASE_URL)}&launch=test-launch`)),
        )

        expect(`${location.origin}${location.pathname}`).toBe(AUTHORIZATION_ENDPOINT)
        expect(location.searchParams.get('client_id')).toBe('NAV_SMART_on_FHIR_validator')
        expect(location.searchParams.get('aud')).toBe(FHIR_BASE_URL)
        expect(location.searchParams.get('redirect_uri')).toBe('https://validator.example.com/callback')
        expect(location.searchParams.get('launch')).toBe('test-launch')
        expect(location.searchParams.get('code_challenge_method')).toBe('S256')
        expect(location.searchParams.get('state')).toBeTruthy()
        expect(setCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, expect.any(String), {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: undefined,
        })
    })
})
