/**
 * Proves the mock EHR itself is correct: everything else in this repo's SMART/FHIR test suite
 * is built on top of it, so a broken fixture would silently invalidate those tests too. Covers
 * the full authorization-code + PKCE flow for every client authentication mode, the `aud` and
 * PKCE checks that make the mock a meaningful adversary rather than a rubber stamp, scope
 * enforcement, Bundle batch/transaction semantics, and a representative sample of defects.
 */
import { randomUUID } from 'node:crypto'

import type { Hono } from 'hono'
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JSONWebKeySet } from 'jose'
import { describe, expect, it } from 'vitest'

import { createOauthState, createPkcePair } from '#core/smart/pkce'

import { PATIENT_ID } from './data/patient'
import { PRACTITIONER_ID } from './data/practitioner'
import { createMockEhr } from './server'
import type { MockEhrConfig } from './state'

const BASE_URL = 'https://mock-ehr.example.com/fhir'
const REDIRECT_URI = 'https://app.example.com/callback'
const CLIENT_ID = 'test-client'
const CLIENT_SECRET = 'test-client-secret'
const SCOPE = 'openid fhirUser launch/patient offline_access patient/Patient.read patient/Encounter.read'
/** Broader than `SCOPE`: needed by tests that create/read a resource `SCOPE` doesn't cover (e.g. Binary). */
const FULL_SCOPE = 'openid fhirUser launch/patient offline_access patient/*.*'

async function get(app: Hono, path: string, headers: Record<string, string> = {}): Promise<Response> {
    return await app.fetch(new Request(`${BASE_URL}${path}`, { headers }))
}

async function postJson(
    app: Hono,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
): Promise<Response> {
    return await app.fetch(
        new Request(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/fhir+json', ...headers },
            body: JSON.stringify(body),
        }),
    )
}

type TokenAuth = {
    headers?: Record<string, string>
    body?: Record<string, string>
}

async function authorize(
    app: Hono,
    params: { clientId: string; scope?: string; aud?: string; codeChallenge: string },
): Promise<URL> {
    const url = new URL(`${BASE_URL}/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', params.clientId)
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('scope', params.scope ?? SCOPE)
    url.searchParams.set('state', createOauthState())
    url.searchParams.set('aud', params.aud ?? BASE_URL)
    url.searchParams.set('code_challenge', params.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')

    const response = await app.fetch(new Request(url.toString()))
    expect(response.status).toBe(302)

    return new URL(response.headers.get('Location') ?? '')
}

async function exchangeCode(
    app: Hono,
    code: string,
    codeVerifier: string,
    auth: TokenAuth,
): Promise<Response> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
        ...auth.body,
    })

    return app.fetch(
        new Request(`${BASE_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...auth.headers },
            body: body.toString(),
        }),
    )
}

/** Runs the full authorize -> token exchange and returns the parsed token response body. */
async function performAuthorizationCodeFlow(
    app: Hono,
    clientId: string,
    auth: TokenAuth,
    scope?: string,
): Promise<Record<string, unknown>> {
    const pkce = createPkcePair()
    const location = await authorize(app, { clientId, scope, codeChallenge: pkce.codeChallenge })
    const code = location.searchParams.get('code')
    expect(code).toBeTruthy()

    const response = await exchangeCode(app, code ?? '', pkce.codeVerifier, auth)
    expect(response.status).toBe(200)

    return (await response.json()) as Record<string, unknown>
}

async function createClientKeyPair(): Promise<{ privateKey: CryptoKey; kid: string; jwks: JSONWebKeySet }> {
    const kid = 'test-client-key'
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)

    return { privateKey, kid, jwks: { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] } }
}

async function signClientAssertion(privateKey: CryptoKey, kid: string, clientId: string): Promise<string> {
    const issuedAt = Math.floor(Date.now() / 1000)

    return await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(clientId)
        .setSubject(clientId)
        .setAudience(`${BASE_URL}/token`)
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 300)
        .sign(privateKey)
}

async function verifyIdToken(app: Hono, idToken: string, audience: string) {
    const jwksResponse = await get(app, '/.well-known/jwks.json')
    const jwks = (await jwksResponse.json()) as JSONWebKeySet
    const keySet = createLocalJWKSet(jwks)

    return await jwtVerify(idToken, keySet, { issuer: BASE_URL, audience })
}

describe('createMockEhr: authorization code + PKCE flow', () => {
    it('completes the flow for a public client', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })

        const token = await performAuthorizationCodeFlow(app, CLIENT_ID, { body: { client_id: CLIENT_ID } })

        expect(token.token_type).toBe('Bearer')
        expect(token.access_token).toEqual(expect.any(String))
        expect(token.refresh_token).toEqual(expect.any(String))
        expect(token.patient).toBe(PATIENT_ID)
        expect(token.fhirUser).toBe(`Practitioner/${PRACTITIONER_ID}`)
        expect(token.need_patient_banner).toBe(true)

        const { payload } = await verifyIdToken(app, token.id_token as string, CLIENT_ID)
        expect(payload.fhirUser).toBe(`Practitioner/${PRACTITIONER_ID}`)
    })

    it('completes the flow for a client_secret_basic client', async () => {
        const config: MockEhrConfig = {
            baseUrl: BASE_URL,
            clientAuth: 'client_secret_basic',
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        }
        const app = await createMockEhr(config)
        const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'utf-8').toString('base64')

        const token = await performAuthorizationCodeFlow(app, CLIENT_ID, {
            headers: { Authorization: `Basic ${credentials}` },
        })

        expect(token.access_token).toEqual(expect.any(String))
        expect(token.id_token).toEqual(expect.any(String))
    })

    it('completes the flow for a client_secret_post client', async () => {
        const config: MockEhrConfig = {
            baseUrl: BASE_URL,
            clientAuth: 'client_secret_post',
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        }
        const app = await createMockEhr(config)

        const token = await performAuthorizationCodeFlow(app, CLIENT_ID, {
            body: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
        })

        expect(token.access_token).toEqual(expect.any(String))
    })

    it('completes the flow for a private_key_jwt client', async () => {
        const { privateKey, kid, jwks } = await createClientKeyPair()
        const config: MockEhrConfig = {
            baseUrl: BASE_URL,
            clientAuth: 'private_key_jwt',
            clientId: CLIENT_ID,
            clientJwks: jwks,
        }
        const app = await createMockEhr(config)
        const assertion = await signClientAssertion(privateKey, kid, CLIENT_ID)

        const token = await performAuthorizationCodeFlow(app, CLIENT_ID, {
            body: {
                client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                client_assertion: assertion,
            },
        })

        expect(token.access_token).toEqual(expect.any(String))
    })
})

describe('createMockEhr: authorize endpoint guards', () => {
    it('rejects an aud that does not equal the FHIR base URL', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })
        const pkce = createPkcePair()

        const location = await authorize(app, {
            clientId: CLIENT_ID,
            codeChallenge: pkce.codeChallenge,
            aud: 'https://wrong-fhir-server.example.com/fhir',
        })

        expect(location.searchParams.get('code')).toBeNull()
        expect(location.searchParams.get('error')).toBe('invalid_request')
    })

    it('accepts a wrong aud when the aud-not-validated defect is enabled', async () => {
        const app = await createMockEhr({
            baseUrl: BASE_URL,
            clientAuth: 'public',
            clientId: CLIENT_ID,
            defects: ['aud-not-validated'],
        })
        const pkce = createPkcePair()

        const location = await authorize(app, {
            clientId: CLIENT_ID,
            codeChallenge: pkce.codeChallenge,
            aud: 'https://wrong-fhir-server.example.com/fhir',
        })

        expect(location.searchParams.get('code')).toBeTruthy()
    })

    it('rejects a token exchange with the wrong code_verifier', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })
        const pkce = createPkcePair()

        const location = await authorize(app, { clientId: CLIENT_ID, codeChallenge: pkce.codeChallenge })
        const code = location.searchParams.get('code') ?? ''

        const response = await exchangeCode(app, code, 'this-is-not-the-right-verifier-at-all-nope', {
            body: { client_id: CLIENT_ID },
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { error: string }
        expect(body.error).toBe('invalid_grant')
    })
})

describe('createMockEhr: FHIR resource access', () => {
    async function accessToken(app: Hono): Promise<string> {
        const token = await performAuthorizationCodeFlow(app, CLIENT_ID, { body: { client_id: CLIENT_ID } })
        return token.access_token as string
    }

    it('rejects a FHIR request with no bearer token', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })

        const response = await get(app, `/Patient/${PATIENT_ID}`)

        expect(response.status).toBe(401)
    })

    it('enforces granted scopes, returning 403 with an OperationOutcome for an uncovered resource', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })

        const pkce = createPkcePair()
        const location = await authorize(app, {
            clientId: CLIENT_ID,
            codeChallenge: pkce.codeChallenge,
            scope: 'openid patient/Patient.read',
        })
        const code = location.searchParams.get('code') ?? ''
        const tokenResponse = await exchangeCode(app, code, pkce.codeVerifier, {
            body: { client_id: CLIENT_ID },
        })
        const { access_token: accessTokenValue } = (await tokenResponse.json()) as { access_token: string }

        const response = await get(app, '/Encounter', { Authorization: `Bearer ${accessTokenValue}` })

        expect(response.status).toBe(403)
        const outcome = (await response.json()) as { resourceType: string; issue: { code: string }[] }
        expect(outcome.resourceType).toBe('OperationOutcome')
        expect(outcome.issue[0]?.code).toBe('forbidden')
    })

    it('allows a request covered by the granted scope', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })
        const token = await accessToken(app)

        const response = await get(app, `/Patient/${PATIENT_ID}`, { Authorization: `Bearer ${token}` })

        expect(response.status).toBe(200)
    })
})

describe('createMockEhr: Bundle batch and transaction semantics', () => {
    async function bearerToken(app: Hono): Promise<string> {
        const token = await performAuthorizationCodeFlow(
            app,
            CLIENT_ID,
            { body: { client_id: CLIENT_ID } },
            FULL_SCOPE,
        )
        return token.access_token as string
    }

    it('processes a batch Bundle entry-by-entry: one failing entry does not fail the others', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })
        const token = await bearerToken(app)

        const response = await postJson(
            app,
            '',
            {
                resourceType: 'Bundle',
                type: 'batch',
                entry: [
                    { request: { method: 'GET', url: `Patient/${PATIENT_ID}` } },
                    { request: { method: 'GET', url: 'Patient/does-not-exist' } },
                ],
            },
            { Authorization: `Bearer ${token}` },
        )

        expect(response.status).toBe(200)
        const bundle = (await response.json()) as {
            type: string
            entry: { resource?: { resourceType: string }; response: { status: string; outcome?: unknown } }[]
        }
        expect(bundle.type).toBe('batch-response')
        expect(bundle.entry[0]?.resource?.resourceType).toBe('Patient')
        expect(bundle.entry[0]?.response.status).toMatch(/^200/)
        expect(bundle.entry[1]?.response.status).toMatch(/^404/)
        expect(bundle.entry[1]?.response.outcome).toBeDefined()
    })

    it('processes a transaction Bundle atomically, rolling back on any entry failure', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public', clientId: CLIENT_ID })
        const token = await bearerToken(app)
        const binaryId = 'txn-rollback-binary'

        const response = await postJson(
            app,
            '',
            {
                resourceType: 'Bundle',
                type: 'transaction',
                entry: [
                    {
                        request: { method: 'POST', url: 'Binary' },
                        resource: {
                            resourceType: 'Binary',
                            id: binaryId,
                            contentType: 'application/pdf',
                            data: 'AAAA',
                        },
                    },
                    { request: { method: 'GET', url: 'Patient/does-not-exist' } },
                ],
            },
            { Authorization: `Bearer ${token}` },
        )

        expect(response.status).toBe(400)

        const check = await get(app, `/Binary/${binaryId}`, { Authorization: `Bearer ${token}` })
        expect(check.status).toBe(404)
    })

    it('rejects a batch Bundle when the bundle-transaction-only defect is enabled', async () => {
        const app = await createMockEhr({
            baseUrl: BASE_URL,
            clientAuth: 'public',
            clientId: CLIENT_ID,
            defects: ['bundle-transaction-only'],
        })
        const token = await bearerToken(app)

        const response = await postJson(
            app,
            '',
            { resourceType: 'Bundle', type: 'batch', entry: [] },
            { Authorization: `Bearer ${token}` },
        )

        expect(response.status).toBe(400)
    })
})

describe('createMockEhr: defects change the response', () => {
    it('well-known-404 makes the discovery document unreachable', async () => {
        const app = await createMockEhr({
            baseUrl: BASE_URL,
            clientAuth: 'public',
            defects: ['well-known-404'],
        })

        const response = await get(app, '/.well-known/smart-configuration')

        expect(response.status).toBe(404)
    })

    it('is conformant by default: the discovery document advertises S256-only PKCE', async () => {
        const app = await createMockEhr({ baseUrl: BASE_URL, clientAuth: 'public' })

        const response = await get(app, '/.well-known/smart-configuration')
        const doc = (await response.json()) as {
            code_challenge_methods_supported: string[]
            issuer: string
        }

        expect(response.status).toBe(200)
        expect(doc.code_challenge_methods_supported).toEqual(['S256'])
        expect(doc.issuer).toBe(BASE_URL)
    })

    it('patient-missing-identifier omits Patient.identifier', async () => {
        const app = await createMockEhr({
            baseUrl: BASE_URL,
            clientAuth: 'public',
            clientId: CLIENT_ID,
            defects: ['patient-missing-identifier'],
        })
        const token = await performAuthorizationCodeFlow(app, CLIENT_ID, { body: { client_id: CLIENT_ID } })

        const response = await get(app, `/Patient/${PATIENT_ID}`, {
            Authorization: `Bearer ${token.access_token as string}`,
        })
        const patient = (await response.json()) as { identifier?: unknown }

        expect(patient.identifier).toBeUndefined()
    })

    it('token-response-narrows-scopes grants fewer scopes than requested', async () => {
        const app = await createMockEhr({
            baseUrl: BASE_URL,
            clientAuth: 'public',
            clientId: CLIENT_ID,
            defects: ['token-response-narrows-scopes'],
        })

        const token = await performAuthorizationCodeFlow(app, CLIENT_ID, { body: { client_id: CLIENT_ID } })

        const requested = SCOPE.split(' ')
        const granted = (token.scope as string).split(' ')
        expect(granted.length).toBeLessThan(requested.length)
    })
})
