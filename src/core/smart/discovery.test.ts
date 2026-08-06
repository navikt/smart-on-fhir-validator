import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'

import { buildWellKnownUrl, fetchSmartConfiguration, resolveEndpoint } from './discovery'
import { isSmartError } from './types'

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        return handler(url, init)
    }) as typeof fetch
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    })
}

function clientReturning(response: Response | (() => Response | Promise<Response>)): SmartHttpClient {
    return new SmartHttpClient({
        recorder: createExchangeRecorder(),
        fetchImpl: stubFetch(typeof response === 'function' ? response : () => response),
    })
}

describe('buildWellKnownUrl', () => {
    it.each([
        ['https://ehr.example.com', 'https://ehr.example.com/.well-known/smart-configuration'],
        ['https://ehr.example.com/', 'https://ehr.example.com/.well-known/smart-configuration'],
        [
            'https://www.ehr.example.com/apis/fhir',
            'https://www.ehr.example.com/apis/fhir/.well-known/smart-configuration',
        ],
        [
            'https://www.ehr.example.com/apis/fhir/',
            'https://www.ehr.example.com/apis/fhir/.well-known/smart-configuration',
        ],
    ])('appends the well-known path to %s', (base, expected) => {
        expect(buildWellKnownUrl(base)).toBe(expected)
    })
})

describe('resolveEndpoint', () => {
    it('returns undefined unchanged', () => {
        expect(resolveEndpoint(undefined, 'https://ehr.example.com/fhir')).toBeUndefined()
    })

    it('leaves an absolute URL unchanged', () => {
        expect(resolveEndpoint('https://auth.example.com/authorize', 'https://ehr.example.com/fhir')).toBe(
            'https://auth.example.com/authorize',
        )
    })

    it('resolves a root-relative URL against the FHIR base per RFC 3986 §5', () => {
        expect(resolveEndpoint('/auth/authorize', 'https://ehr.example.com/fhir')).toBe(
            'https://ehr.example.com/auth/authorize',
        )
    })

    it('resolves a document-relative URL against the FHIR base', () => {
        expect(resolveEndpoint('authorize', 'https://ehr.example.com/fhir/')).toBe(
            'https://ehr.example.com/fhir/authorize',
        )
    })

    it('returns the original value unchanged when it cannot be resolved at all', () => {
        expect(resolveEndpoint('/auth', 'not a base url')).toBe('/auth')
    })
})

describe('fetchSmartConfiguration', () => {
    it('parses a fully conformant document', async () => {
        const client = clientReturning(
            jsonResponse({
                issuer: 'https://ehr.example.com',
                jwks_uri: 'https://ehr.example.com/.well-known/jwks.json',
                authorization_endpoint: 'https://ehr.example.com/auth/authorize',
                token_endpoint: 'https://ehr.example.com/auth/token',
                grant_types_supported: ['authorization_code'],
                capabilities: ['launch-ehr', 'sso-openid-connect'],
                code_challenge_methods_supported: ['S256'],
            }),
        )

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (isSmartError(result)) throw new Error('expected success')

        expect(result.config.token_endpoint).toBe('https://ehr.example.com/auth/token')
        expect(result.config.capabilities).toEqual(['launch-ehr', 'sso-openid-connect'])
        expect(result.exchange.phase).toBe('discovery')
        expect(result.exchange.request.url).toBe(
            'https://ehr.example.com/fhir/.well-known/smart-configuration',
        )
    })

    it('parses successfully, without throwing, when the document is missing every field', async () => {
        const client = clientReturning(jsonResponse({}))

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (isSmartError(result)) throw new Error('expected success')

        expect(result.config).toEqual({})
    })

    it('passes unknown fields through untouched (lenient/passthrough parsing)', async () => {
        const client = clientReturning(
            jsonResponse({
                token_endpoint: 'https://ehr.example.com/token',
                smart_app_state_endpoint: 'https://x',
            }),
        )

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (isSmartError(result)) throw new Error('expected success')

        expect((result.config as Record<string, unknown>).smart_app_state_endpoint).toBe('https://x')
    })

    it('treats a field with the wrong runtime type as absent rather than failing the whole parse', async () => {
        const client = clientReturning(
            jsonResponse({
                token_endpoint: 'https://ehr.example.com/token',
                capabilities: 'launch-ehr', // hostile: string instead of an array
                grant_types_supported: 42, // hostile: number instead of an array
            }),
        )

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (isSmartError(result)) throw new Error('expected success')

        expect(result.config.token_endpoint).toBe('https://ehr.example.com/token')
        expect(result.config.capabilities).toBeUndefined()
        expect(result.config.grant_types_supported).toBeUndefined()
    })

    it('drops malformed associated_endpoints entries but keeps the well-formed ones', async () => {
        const client = clientReturning(
            jsonResponse({
                associated_endpoints: [
                    { url: 'https://state.example.com', capabilities: ['smart-app-state'] },
                    { capabilities: ['smart-app-state'] }, // hostile: missing required url
                    'not-an-object',
                ],
            }),
        )

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (isSmartError(result)) throw new Error('expected success')

        expect(result.config.associated_endpoints).toEqual([
            { url: 'https://state.example.com', capabilities: ['smart-app-state'] },
        ])
    })

    it('treats a root JSON array as an empty configuration rather than throwing', async () => {
        const client = clientReturning(jsonResponse([1, 2, 3]))

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (isSmartError(result)) throw new Error('expected success')

        expect(result.config).toEqual({})
    })

    it('returns a SmartError for a non-2xx status', async () => {
        const client = clientReturning(jsonResponse({ error: 'not found' }, { status: 404 }))

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (!isSmartError(result)) throw new Error('expected an error')

        expect(result.error).toContain('404')
        expect(result.exchangeId).toBeTruthy()
    })

    it('returns a SmartError for a non-JSON body', async () => {
        const client = clientReturning(new Response('<html>oops</html>', { status: 200 }))

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (!isSmartError(result)) throw new Error('expected an error')

        expect(result.error).toMatch(/JSON/i)
    })

    it('returns a SmartError with detail for a transport failure, without throwing', async () => {
        const client = clientReturning(() => {
            throw new Error('getaddrinfo ENOTFOUND ehr.example.com')
        })

        const result = await fetchSmartConfiguration(client, 'https://ehr.example.com/fhir')
        if (!isSmartError(result)) throw new Error('expected an error')

        expect(result.detail).toBe('getaddrinfo ENOTFOUND ehr.example.com')
        expect(result.exchangeId).toBeTruthy()
    })
})
