import { describe, expect, it, vi } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { isSmartError } from '#core/smart/types'

import { getPublicJwks } from './jwks'
import { registerClient } from './registration'

const REGISTRATION_ENDPOINT = 'https://ehr.example.com/oauth/register'
const FHIR_BASE_URL = 'https://ehr.example.com/fhir'

function jsonResponse(body: unknown, status = 201): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

function clientWithFetch(fetchImpl: typeof fetch): SmartHttpClient {
    return new SmartHttpClient({ recorder: createExchangeRecorder(), fetchImpl })
}

describe('registerClient', () => {
    it('registers a public client and returns type "public"', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ client_id: 'generated-id' }))
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch openid fhirUser',
            tokenEndpointAuthMethod: 'none',
        })

        expect(isSmartError(result)).toBe(false)
        if (isSmartError(result)) return
        expect(result.fhirBaseUrl).toBe(FHIR_BASE_URL)
        expect(result.clientId).toBe('generated-id')
        expect(result.auth).toEqual({ type: 'public' })
        expect(result.dynamicallyRegistered).toBe(true)
    })

    it('sends RFC 7591 metadata, including jwks_uri only for private_key_jwt', async () => {
        let capturedBody: unknown
        const fetchImpl = vi.fn<typeof fetch>(async (_url: RequestInfo | URL, init?: RequestInit) => {
            capturedBody = JSON.parse(init?.body as string)
            return jsonResponse({ client_id: 'x', token_endpoint_auth_method: 'private_key_jwt' })
        })
        const client = clientWithFetch(fetchImpl)

        await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'private_key_jwt',
            jwksUri: 'https://validator.nav.no/.well-known/jwks.json',
        })

        expect(capturedBody).toMatchObject({
            client_name: 'Nav validator',
            redirect_uris: ['https://validator.nav.no/callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            scope: 'launch',
            token_endpoint_auth_method: 'private_key_jwt',
            jwks_uri: 'https://validator.nav.no/.well-known/jwks.json',
        })
    })

    it('does not send jwks_uri for a symmetric registration even if provided', async () => {
        let capturedBody: Record<string, unknown> = {}
        const fetchImpl = vi.fn<typeof fetch>(async (_url: RequestInfo | URL, init?: RequestInit) => {
            capturedBody = JSON.parse(init?.body as string)
            return jsonResponse({ client_id: 'x', client_secret: 'secret' })
        })
        const client = clientWithFetch(fetchImpl)

        await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'client_secret_post',
            jwksUri: 'https://validator.nav.no/.well-known/jwks.json',
        })

        expect(capturedBody.jwks_uri).toBeUndefined()
    })

    it('maps a granted client_secret_post to a symmetric ClientAuthMode', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse({
                client_id: 'generated-id',
                client_secret: 'generated-secret',
                token_endpoint_auth_method: 'client_secret_post',
            }),
        )
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'client_secret_post',
        })

        expect(isSmartError(result)).toBe(false)
        if (isSmartError(result)) return
        expect(result.auth).toEqual({
            type: 'confidential-symmetric',
            method: 'client_secret_post',
            clientSecret: 'generated-secret',
        })
    })

    it('falls back to the requested auth method when the server omits token_endpoint_auth_method', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse({ client_id: 'generated-id', client_secret: 'generated-secret' }),
        )
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'client_secret_basic',
        })

        expect(isSmartError(result)).toBe(false)
        if (isSmartError(result)) return
        expect(result.auth).toEqual({
            type: 'confidential-symmetric',
            method: 'client_secret_basic',
            clientSecret: 'generated-secret',
        })
    })

    it('returns a SmartError when a symmetric method is granted without a client_secret', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse({ client_id: 'generated-id', token_endpoint_auth_method: 'client_secret_post' }),
        )
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'client_secret_post',
        })

        expect(isSmartError(result)).toBe(true)
        if (!isSmartError(result)) return
        expect(result.error).toContain('client_secret')
        expect(result.exchangeId).toBeDefined()
    })

    it("maps a granted private_key_jwt to an asymmetric ClientAuthMode using this app's own signing key", async () => {
        delete process.env.SMART_PRIVATE_JWK
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse({ client_id: 'generated-id', token_endpoint_auth_method: 'private_key_jwt' }),
        )
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'private_key_jwt',
            jwksUri: 'https://validator.nav.no/.well-known/jwks.json',
        })

        expect(isSmartError(result)).toBe(false)
        if (isSmartError(result)) return
        expect(result.auth.type).toBe('confidential-asymmetric')
        if (result.auth.type !== 'confidential-asymmetric') return

        const { keyId, algorithm, privateKeyJwk } = result.auth
        const { keys } = await getPublicJwks()
        expect(keyId).toBe(keys[0]?.kid)
        expect(algorithm).toBe('ES384')

        // The registered private key must actually match the app's published public key.
        const { importJWK, SignJWT, jwtVerify } = await import('jose')
        const privateKey = await importJWK(JSON.parse(privateKeyJwk), algorithm)
        const jwt = await new SignJWT({}).setProtectedHeader({ alg: algorithm, kid: keyId }).sign(privateKey)
        const publicKey = await importJWK(keys[0] as never, algorithm)
        await expect(jwtVerify(jwt, publicKey)).resolves.toBeDefined()
    })

    it('returns a SmartError including the RFC 7591 error body on a non-2xx response', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse(
                { error: 'invalid_client_metadata', error_description: 'redirect_uris required' },
                400,
            ),
        )
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: [],
            scope: 'launch',
            tokenEndpointAuthMethod: 'none',
        })

        expect(isSmartError(result)).toBe(true)
        if (!isSmartError(result)) return
        expect(result.error).toContain('invalid_client_metadata')
        expect(result.detail).toBe('redirect_uris required')
        expect(result.exchangeId).toBeDefined()
    })

    it('returns a generic SmartError on a non-2xx response without an RFC 7591 error body', async () => {
        const fetchImpl = vi.fn<typeof fetch>(
            async () => new Response('Internal Server Error', { status: 500 }),
        )
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'none',
        })

        expect(isSmartError(result)).toBe(true)
        if (!isSmartError(result)) return
        expect(result.error).toContain('500')
    })

    it('returns a SmartError when the 2xx response has no usable client_id', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ not_a_client_id: true }))
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'none',
        })

        expect(isSmartError(result)).toBe(true)
    })

    it('never throws, even on a network failure', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () => {
            throw new Error('network down')
        })
        const client = clientWithFetch(fetchImpl)

        const result = await registerClient(client, REGISTRATION_ENDPOINT, {
            fhirBaseUrl: FHIR_BASE_URL,
            clientName: 'Nav validator',
            redirectUris: ['https://validator.nav.no/callback'],
            scope: 'launch',
            tokenEndpointAuthMethod: 'none',
        })

        expect(isSmartError(result)).toBe(true)
    })
})
