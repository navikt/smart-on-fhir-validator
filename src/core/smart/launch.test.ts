import { describe, expect, it, vi } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { createInMemorySessionStore } from '#core/storage/session-store'
import type { IssuerConfig, SmartConfiguration, SmartError } from '#core/smart/types'
import { isSmartError } from '#core/smart/types'

import {
    handleLaunch,
    type FetchSmartConfiguration,
    type LaunchDependencies,
    PENDING_SESSION_TTL_SECONDS,
    type RegisterClient,
    validateFhirBaseUrl,
} from './launch'

const FHIR_BASE_URL = 'https://ehr.example.com/fhir'
const AUTHORIZATION_ENDPOINT = 'https://ehr.example.com/oauth/authorize'
const TOKEN_ENDPOINT = 'https://ehr.example.com/oauth/token'
const REDIRECT_URI = 'https://validator.nav.no/callback'
const SCOPE = 'openid launch fhirUser patient/Patient.read'

function neverCalledHttpClient(): SmartHttpClient {
    const fetchImpl = vi.fn<() => never>(() => {
        throw new Error('the HTTP client must not be used directly by handleLaunch')
    })

    return new SmartHttpClient({ recorder: createExchangeRecorder(), fetchImpl })
}

function smartConfiguration(overrides: Partial<SmartConfiguration> = {}): SmartConfiguration {
    return {
        issuer: 'https://ehr.example.com',
        authorization_endpoint: AUTHORIZATION_ENDPOINT,
        token_endpoint: TOKEN_ENDPOINT,
        ...overrides,
    }
}

function baseDeps(overrides: Partial<LaunchDependencies> = {}): LaunchDependencies {
    return {
        httpClient: neverCalledHttpClient(),
        recorder: createExchangeRecorder(),
        sessionStore: createInMemorySessionStore(),
        fetchSmartConfiguration: async () => ({
            config: smartConfiguration(),
            raw: {},
            exchange: {} as never,
        }),
        resolveEndpoint: (value) => value,
        findIssuerConfig: () => null,
        registerClient: async () => {
            throw new Error('registerClient should not be called in this test')
        },
        createPkcePair: () => ({
            codeVerifier: 'verifier-abc',
            codeChallenge: 'challenge-abc',
            method: 'S256',
        }),
        createOauthState: () => 'state-abc',
        createSessionId: () => 'session-abc',
        redirectUri: REDIRECT_URI,
        scope: SCOPE,
        clientName: 'Nav SMART on FHIR Validator',
        now: () => new Date('2024-01-01T00:00:00.000Z'),
        ...overrides,
    }
}

describe('validateFhirBaseUrl', () => {
    it('accepts an absolute https URL', () => {
        const result = validateFhirBaseUrl('https://ehr.example.com/fhir')
        expect(result).toBeInstanceOf(URL)
    })

    it('rejects a non-URL string', () => {
        const result = validateFhirBaseUrl('not a url')
        expect(isSmartError(result as SmartError)).toBe(true)
    })

    it('rejects a relative path', () => {
        const result = validateFhirBaseUrl('/fhir')
        expect(isSmartError(result as SmartError)).toBe(true)
    })

    it('rejects a plain http URL by default — an attacker-supplied iss must not redirect credentials to a non-https server', () => {
        const result = validateFhirBaseUrl('http://ehr.example.com/fhir')
        expect(isSmartError(result as SmartError)).toBe(true)
        expect((result as SmartError).error).toBe('invalid_iss')
    })

    it('rejects other schemes such as javascript: or file:', () => {
        expect(isSmartError(validateFhirBaseUrl('javascript:alert(1)') as SmartError)).toBe(true)
        expect(isSmartError(validateFhirBaseUrl('file:///etc/passwd') as SmartError)).toBe(true)
    })

    it('allows http only for loopback hosts, which are unreachable from the network', () => {
        expect(validateFhirBaseUrl('http://localhost:8080/fhir')).toBeInstanceOf(URL)
        expect(validateFhirBaseUrl('http://127.0.0.1:8080/fhir')).toBeInstanceOf(URL)
    })

    it('rejects an http host that merely looks like loopback', () => {
        // `localhost.evil.example` and `127.0.0.1.evil.example` resolve to whatever an attacker
        // wants; only an exact loopback host is safe to exempt from https.
        expect(isSmartError(validateFhirBaseUrl('http://localhost.evil.example/fhir') as SmartError)).toBe(
            true,
        )
        expect(isSmartError(validateFhirBaseUrl('http://127.0.0.1.evil.example/fhir') as SmartError)).toBe(
            true,
        )
    })

    it('applies the same rule regardless of NODE_ENV, so the e2e suite tests what is deployed', () => {
        const original = process.env.NODE_ENV

        try {
            vi.stubEnv('NODE_ENV', 'production')
            expect(validateFhirBaseUrl('http://localhost:3100/fhir')).toBeInstanceOf(URL)
            expect(isSmartError(validateFhirBaseUrl('http://ehr.example.com/fhir') as SmartError)).toBe(true)
        } finally {
            vi.stubEnv('NODE_ENV', original ?? 'test')
            vi.unstubAllEnvs()
        }
    })
})

describe('handleLaunch', () => {
    it('rejects an insecure iss before making any network call', async () => {
        const fetchSmartConfiguration = vi.fn<FetchSmartConfiguration>()
        const result = await handleLaunch(
            { iss: 'http://attacker.example.com/fhir', launch: 'launch-1' },
            baseDeps({ fetchSmartConfiguration }),
        )

        expect(isSmartError(result as SmartError)).toBe(true)
        expect(fetchSmartConfiguration).not.toHaveBeenCalled()
    })

    it('requires a launch parameter', async () => {
        const result = await handleLaunch({ iss: FHIR_BASE_URL, launch: '' }, baseDeps())
        expect(result).toMatchObject({ error: 'missing_launch' })
    })

    it('passes through a discovery failure', async () => {
        const discoveryError: SmartError = { error: 'discovery_failed', detail: 'boom' }
        const result = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps({ fetchSmartConfiguration: async () => discoveryError }),
        )

        expect(result).toEqual(discoveryError)
    })

    it('fails when the SMART configuration has no authorization_endpoint', async () => {
        const result = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps({
                fetchSmartConfiguration: async () => ({
                    config: smartConfiguration({ authorization_endpoint: undefined }),
                    raw: {},
                    exchange: {} as never,
                }),
            }),
        )

        expect(result).toMatchObject({ error: 'missing_authorization_endpoint' })
    })

    it('prefers a statically configured client over dynamic registration', async () => {
        const staticConfig: IssuerConfig = {
            issuer: 'https://ehr.example.com',
            clientId: 'static-client',
            auth: { type: 'public' },
            dynamicallyRegistered: false,
        }
        const registerClient = vi.fn<RegisterClient>()

        const result = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps({
                findIssuerConfig: () => staticConfig,
                registerClient,
                fetchSmartConfiguration: async () => ({
                    config: smartConfiguration({ registration_endpoint: 'https://ehr.example.com/register' }),
                    raw: {},
                    exchange: {} as never,
                }),
            }),
        )

        expect(registerClient).not.toHaveBeenCalled()
        expect(result).toMatchObject({ sessionId: 'session-abc' })
    })

    it('falls back to dynamic client registration, requested as a public client, when no static config exists', async () => {
        const registrationEndpoint = 'https://ehr.example.com/register'
        const registerClient = vi.fn<RegisterClient>(async () => ({
            issuer: 'https://ehr.example.com',
            clientId: 'dcr-client',
            auth: { type: 'public' as const },
            dynamicallyRegistered: true,
        }))

        const result = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps({
                registerClient,
                fetchSmartConfiguration: async () => ({
                    config: smartConfiguration({ registration_endpoint: registrationEndpoint }),
                    raw: {},
                    exchange: {} as never,
                }),
            }),
        )

        expect(registerClient).toHaveBeenCalledWith(
            expect.anything(),
            registrationEndpoint,
            expect.objectContaining({
                issuer: 'https://ehr.example.com',
                clientName: 'Nav SMART on FHIR Validator',
                redirectUris: [REDIRECT_URI],
                scope: SCOPE,
                tokenEndpointAuthMethod: 'none',
            }),
        )
        expect(isSmartError(result as SmartError)).toBe(false)
    })

    it('falls back to the default public client when neither static config nor registration is available', async () => {
        const result = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps({ defaultPublicClientId: 'shared-public-client' }),
        )

        expect(isSmartError(result as SmartError)).toBe(false)
    })

    it('fails with no_client_configuration when nothing is available', async () => {
        const result = await handleLaunch({ iss: FHIR_BASE_URL, launch: 'launch-1' }, baseDeps())
        expect(result).toMatchObject({ error: 'no_client_configuration' })
    })

    it('builds an authorization URL with every SMART-required parameter, and persists the pending session', async () => {
        const staticConfig: IssuerConfig = {
            issuer: 'https://ehr.example.com',
            clientId: 'client-123',
            auth: { type: 'public' },
            dynamicallyRegistered: false,
        }
        const sessionStore = createInMemorySessionStore()

        const result = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-xyz' },
            baseDeps({ findIssuerConfig: () => staticConfig, sessionStore }),
        )

        if (isSmartError(result as SmartError)) throw new Error('expected success')
        const { sessionId, redirectUrl } = result as { sessionId: string; redirectUrl: string }

        const url = new URL(redirectUrl)
        expect(url.origin + url.pathname).toBe(AUTHORIZATION_ENDPOINT)
        expect(url.searchParams.get('response_type')).toBe('code')
        expect(url.searchParams.get('client_id')).toBe('client-123')
        expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
        expect(url.searchParams.get('scope')).toBe(SCOPE)
        expect(url.searchParams.get('state')).toBe('state-abc')
        // REQUIRED by SMART App Launch and a very common vendor bug when omitted.
        expect(url.searchParams.get('aud')).toBe(FHIR_BASE_URL)
        expect(url.searchParams.get('launch')).toBe('launch-xyz')
        expect(url.searchParams.get('code_challenge')).toBe('challenge-abc')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')

        const stored = await sessionStore.get(sessionId)
        expect(stored).toMatchObject({
            state: 'pending',
            sessionId,
            issuer: 'https://ehr.example.com',
            fhirBaseUrl: FHIR_BASE_URL,
            clientId: 'client-123',
            oauthState: 'state-abc',
            codeVerifier: 'verifier-abc',
            launch: 'launch-xyz',
            requestedScope: SCOPE,
        })
    })

    it('persists the pending session with the configured TTL', async () => {
        const staticConfig: IssuerConfig = {
            issuer: 'https://ehr.example.com',
            clientId: 'client-123',
            auth: { type: 'public' },
            dynamicallyRegistered: false,
        }
        const sessionStore = createInMemorySessionStore()
        const setSpy = vi.spyOn(sessionStore, 'set')

        await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-xyz' },
            baseDeps({ findIssuerConfig: () => staticConfig, sessionStore }),
        )

        expect(setSpy).toHaveBeenCalledWith('session-abc', expect.anything(), PENDING_SESSION_TTL_SECONDS)
    })
})
