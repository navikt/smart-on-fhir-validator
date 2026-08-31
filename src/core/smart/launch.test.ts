import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { createInMemorySessionStore } from '#core/storage/session-store'
import type { IssuerConfig, SmartConfiguration, SmartError } from '#core/smart/types'
import { isSmartError } from '#core/smart/types'

import {
    handleLaunch,
    type FetchSmartConfiguration,
    type LaunchDependencies,
    MAX_DYNAMIC_REGISTRATIONS,
    PENDING_SESSION_TTL_SECONDS,
    type RegisterClient,
    resetDynamicRegistrationCacheForTests,
    validateFhirBaseUrl,
} from './launch'

const FHIR_BASE_URL = 'https://ehr.example.com/fhir'
const AUTHORIZATION_ENDPOINT = 'https://ehr.example.com/oauth/authorize'
const TOKEN_ENDPOINT = 'https://ehr.example.com/oauth/token'
const REDIRECT_URI = 'https://validator.nav.no/callback'
const SCOPE = 'openid launch fhirUser patient/Patient.read'

/** A distinct FHIR base URL per index, for tests that need many of them to fill the cache. */
function settledBaseUrl(index: number): string {
    return `https://ehr-settled-${index}.example.com/fhir`
}

// The dynamic registration cache is a process-wide singleton (globalThis), so without this a
// registration cached by one test would leak into the next test's assertions about how many
// times its own registerClient mock was called.
afterEach(() => {
    resetDynamicRegistrationCacheForTests()
})

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

    it('rejects a plain http URL by default, since an attacker-supplied iss must not redirect credentials to a non-https server', () => {
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
        // Only an exact loopback host is safe to exempt from https: `localhost.evil.example`
        // resolves to whatever an attacker wants.
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
            fhirBaseUrl: FHIR_BASE_URL,
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

    it(
        'matches static configuration by the TLS-authenticated FHIR base URL, not by ' +
            "smartConfiguration.issuer, when the two name different origins (the Oracle Health/Cerner " +
            'shape: FHIR on one host, the OIDC issuer on another)',
        async () => {
            // Oracle Health/Cerner really does this: FHIR is served from `fhir-ehr-code.cerner.com`
            // while the OIDC issuer published in `.well-known/smart-configuration` is a different
            // host under `authorization.cerner.com`. SMART App Launch 2.2 places no same-origin
            // constraint between the two (conformance.html: every discovery endpoint URL need only
            // be "absolute"), and `issuer` is CONDITIONAL OIDC metadata for id_token validation, not
            // a FHIR server identity. A registered vendor's static configuration must still match.
            const staticConfig: IssuerConfig = {
                fhirBaseUrl: FHIR_BASE_URL,
                clientId: 'static-client',
                auth: { type: 'public' },
                dynamicallyRegistered: false,
            }
            const findIssuerConfig = vi.fn<(fhirBaseUrl: string) => IssuerConfig | null>((fhirBaseUrl) =>
                fhirBaseUrl === FHIR_BASE_URL ? staticConfig : null,
            )

            const result = await handleLaunch(
                { iss: FHIR_BASE_URL, launch: 'launch-1' },
                baseDeps({
                    findIssuerConfig,
                    fetchSmartConfiguration: async () => ({
                        config: smartConfiguration({ issuer: 'https://authorization.cerner.example.com' }),
                        raw: {},
                        exchange: {} as never,
                    }),
                }),
            )

            // Looked up by fhirBaseUrl, never by the differently-hosted smartConfiguration.issuer.
            expect(findIssuerConfig).toHaveBeenCalledWith(FHIR_BASE_URL)
            expect(findIssuerConfig).not.toHaveBeenCalledWith('https://authorization.cerner.example.com')

            if (isSmartError(result as SmartError)) throw new Error('expected success')
            const url = new URL((result as { redirectUrl: string }).redirectUrl)
            expect(url.searchParams.get('client_id')).toBe('static-client')
        },
    )

    it('falls back to dynamic client registration, requested as a public client, when no static config exists', async () => {
        const registrationEndpoint = 'https://ehr.example.com/register'
        const registerClient = vi.fn<RegisterClient>(async () => ({
            fhirBaseUrl: FHIR_BASE_URL,
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
                // Regression guard for the fix in `resolveIssuerConfig`: the TLS-authenticated FHIR
                // base URL is what gets passed on for registration/lookup, never
                // `smartConfiguration.issuer` (which this fixture deliberately sets to a different
                // value, see `smartConfiguration()` above).
                fhirBaseUrl: FHIR_BASE_URL,
                clientName: 'Nav SMART on FHIR Validator',
                redirectUris: [REDIRECT_URI],
                scope: SCOPE,
                tokenEndpointAuthMethod: 'none',
            }),
        )
        expect(isSmartError(result as SmartError)).toBe(false)
    })

    it('fails with no_client_configuration when nothing is available', async () => {
        const result = await handleLaunch({ iss: FHIR_BASE_URL, launch: 'launch-1' }, baseDeps())
        expect(result).toMatchObject({ error: 'no_client_configuration' })
    })

    it('builds an authorization URL with every SMART-required parameter, and persists the pending session', async () => {
        const staticConfig: IssuerConfig = {
            fhirBaseUrl: FHIR_BASE_URL,
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
            fhirBaseUrl: FHIR_BASE_URL,
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

describe('handleLaunch dynamic registration caching', () => {
    const registrationEndpoint = 'https://ehr.example.com/register'
    const otherFhirBaseUrl = 'https://other-ehr.example.com/fhir'

    function depsWithRegistration(registerClient: RegisterClient): Partial<LaunchDependencies> {
        return {
            registerClient,
            fetchSmartConfiguration: async () => ({
                config: smartConfiguration({ registration_endpoint: registrationEndpoint }),
                raw: {},
                exchange: {} as never,
            }),
        }
    }

    it('registers once and reuses the client id across sequential launches for the same FHIR base URL', async () => {
        const registerClient = vi.fn<RegisterClient>(async () => ({
            fhirBaseUrl: FHIR_BASE_URL,
            clientId: 'dcr-client-1',
            auth: { type: 'public' as const },
            dynamicallyRegistered: true,
        }))

        const first = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps(depsWithRegistration(registerClient)),
        )
        const second = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-2' },
            baseDeps(depsWithRegistration(registerClient)),
        )

        expect(registerClient).toHaveBeenCalledTimes(1)
        if (isSmartError(first as SmartError) || isSmartError(second as SmartError)) {
            throw new Error('expected both launches to succeed')
        }
        const firstClientId = new URL((first as { redirectUrl: string }).redirectUrl).searchParams.get(
            'client_id',
        )
        const secondClientId = new URL((second as { redirectUrl: string }).redirectUrl).searchParams.get(
            'client_id',
        )
        expect(firstClientId).toBe('dcr-client-1')
        expect(secondClientId).toBe('dcr-client-1')
    })

    it('registers independently for a different FHIR base URL', async () => {
        const registerClient = vi.fn<RegisterClient>(async (_httpClient, _endpoint, params) => ({
            fhirBaseUrl: params.fhirBaseUrl,
            clientId: params.fhirBaseUrl === FHIR_BASE_URL ? 'dcr-client-a' : 'dcr-client-b',
            auth: { type: 'public' as const },
            dynamicallyRegistered: true,
        }))

        await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps(depsWithRegistration(registerClient)),
        )
        await handleLaunch(
            { iss: otherFhirBaseUrl, launch: 'launch-1' },
            baseDeps(depsWithRegistration(registerClient)),
        )

        expect(registerClient).toHaveBeenCalledTimes(2)
        expect(registerClient).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            registrationEndpoint,
            expect.objectContaining({ fhirBaseUrl: FHIR_BASE_URL }),
        )
        expect(registerClient).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            registrationEndpoint,
            expect.objectContaining({ fhirBaseUrl: otherFhirBaseUrl }),
        )
    })

    it('does not permanently cache a failed registration, and retries it on the next launch', async () => {
        const registerClient = vi
            .fn<RegisterClient>()
            .mockResolvedValueOnce({ error: 'registration_failed', detail: 'vendor is down' })
            .mockResolvedValueOnce({
                fhirBaseUrl: FHIR_BASE_URL,
                clientId: 'dcr-client-recovered',
                auth: { type: 'public' as const },
                dynamicallyRegistered: true,
            })

        const first = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-1' },
            baseDeps(depsWithRegistration(registerClient)),
        )
        expect(first).toMatchObject({ error: 'registration_failed' })

        const second = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-2' },
            baseDeps(depsWithRegistration(registerClient)),
        )

        expect(registerClient).toHaveBeenCalledTimes(2)
        if (isSmartError(second as SmartError)) throw new Error('expected the retry to succeed')
        const clientId = new URL((second as { redirectUrl: string }).redirectUrl).searchParams.get(
            'client_id',
        )
        expect(clientId).toBe('dcr-client-recovered')
    })

    it('does not permanently cache a registration promise that rejects', async () => {
        const registerClient = vi
            .fn<RegisterClient>()
            .mockRejectedValueOnce(new Error('network exploded'))
            .mockResolvedValueOnce({
                fhirBaseUrl: FHIR_BASE_URL,
                clientId: 'dcr-client-after-rejection',
                auth: { type: 'public' as const },
                dynamicallyRegistered: true,
            })

        await expect(
            handleLaunch(
                { iss: FHIR_BASE_URL, launch: 'launch-1' },
                baseDeps(depsWithRegistration(registerClient)),
            ),
        ).rejects.toThrow('network exploded')

        const second = await handleLaunch(
            { iss: FHIR_BASE_URL, launch: 'launch-2' },
            baseDeps(depsWithRegistration(registerClient)),
        )

        expect(registerClient).toHaveBeenCalledTimes(2)
        if (isSmartError(second as SmartError)) throw new Error('expected the retry to succeed')
        const clientId = new URL((second as { redirectUrl: string }).redirectUrl).searchParams.get(
            'client_id',
        )
        expect(clientId).toBe('dcr-client-after-rejection')
    })

    it('coalesces concurrent first launches for the same FHIR base URL into one registration call', async () => {
        // Assigned synchronously by the Promise executor below before it is read; the definite
        // assignment assertion is needed because TypeScript's control-flow analysis does not
        // reason about the Promise executor callback running synchronously.
        let resolveRegistration!: (value: IssuerConfig) => void
        const registrationPromise = new Promise<IssuerConfig>((resolve) => {
            resolveRegistration = resolve
        })
        const registerClient = vi.fn<RegisterClient>(() => registrationPromise)

        const launches = Promise.all([
            handleLaunch(
                { iss: FHIR_BASE_URL, launch: 'launch-1' },
                baseDeps(depsWithRegistration(registerClient)),
            ),
            handleLaunch(
                { iss: FHIR_BASE_URL, launch: 'launch-2' },
                baseDeps(depsWithRegistration(registerClient)),
            ),
        ])

        // Give both launches a chance to reach the registration call before it resolves.
        await new Promise((resolve) => setTimeout(resolve, 0))
        resolveRegistration({
            fhirBaseUrl: FHIR_BASE_URL,
            clientId: 'dcr-client-coalesced',
            auth: { type: 'public' },
            dynamicallyRegistered: true,
        })

        const [first, second] = await launches

        expect(registerClient).toHaveBeenCalledTimes(1)
        if (isSmartError(first as SmartError) || isSmartError(second as SmartError)) {
            throw new Error('expected both launches to succeed')
        }
        const firstClientId = new URL((first as { redirectUrl: string }).redirectUrl).searchParams.get(
            'client_id',
        )
        const secondClientId = new URL((second as { redirectUrl: string }).redirectUrl).searchParams.get(
            'client_id',
        )
        expect(firstClientId).toBe('dcr-client-coalesced')
        expect(secondClientId).toBe('dcr-client-coalesced')
    })

    it(
        'evicts the oldest registration once the cache reaches MAX_DYNAMIC_REGISTRATIONS, so an ' +
            "unauthenticated attacker varying iss can't grow it without bound",
        async () => {
            const registerClient = vi.fn<RegisterClient>(async (_httpClient, _endpoint, params) => ({
                fhirBaseUrl: params.fhirBaseUrl,
                clientId: `dcr-client-${params.fhirBaseUrl}`,
                auth: { type: 'public' as const },
                dynamicallyRegistered: true,
            }))

            // Fill the cache to its cap, one distinct FHIR base URL per entry.
            for (let i = 0; i < MAX_DYNAMIC_REGISTRATIONS; i++) {
                await handleLaunch(
                    { iss: settledBaseUrl(i), launch: 'launch-1' },
                    baseDeps(depsWithRegistration(registerClient)),
                )
            }
            expect(registerClient).toHaveBeenCalledTimes(MAX_DYNAMIC_REGISTRATIONS)

            // One more, distinct, FHIR base URL forces an eviction rather than growing the cache
            // past its cap.
            await handleLaunch(
                { iss: settledBaseUrl(MAX_DYNAMIC_REGISTRATIONS), launch: 'launch-1' },
                baseDeps(depsWithRegistration(registerClient)),
            )
            expect(registerClient).toHaveBeenCalledTimes(MAX_DYNAMIC_REGISTRATIONS + 1)

            // A more recently registered FHIR base URL was not evicted and is still cached.
            // Checked before touching the evicted entry below, since re-registering it would
            // itself need to evict something (the cache is still full) and must not be mistaken
            // for evicting this one.
            await handleLaunch(
                { iss: settledBaseUrl(1), launch: 'launch-2' },
                baseDeps(depsWithRegistration(registerClient)),
            )
            expect(registerClient).toHaveBeenCalledTimes(MAX_DYNAMIC_REGISTRATIONS + 1)

            // The oldest entry (index 0) was the one evicted, so relaunching for it re-registers
            // instead of reusing a stale cache entry.
            await handleLaunch(
                { iss: settledBaseUrl(0), launch: 'launch-2' },
                baseDeps(depsWithRegistration(registerClient)),
            )
            expect(registerClient).toHaveBeenCalledTimes(MAX_DYNAMIC_REGISTRATIONS + 2)
        },
    )

    it('prefers evicting a settled entry over one still in flight when the cache is full', async () => {
        const inFlightBaseUrl = 'https://ehr-inflight.example.com/fhir'
        // Assigned synchronously by the Promise executor below before it is read; see the
        // coalescing test above for why the definite assignment assertion is needed.
        let resolveInFlight!: (value: IssuerConfig) => void

        const registerClient = vi.fn<RegisterClient>((_httpClient, _endpoint, params) => {
            if (params.fhirBaseUrl === inFlightBaseUrl) {
                return new Promise<IssuerConfig>((resolve) => {
                    resolveInFlight = resolve
                })
            }
            return Promise.resolve({
                fhirBaseUrl: params.fhirBaseUrl,
                clientId: `dcr-client-${params.fhirBaseUrl}`,
                auth: { type: 'public' as const },
                dynamicallyRegistered: true,
            })
        })

        // Fill the cache to one below its cap with settled entries.
        for (let i = 0; i < MAX_DYNAMIC_REGISTRATIONS - 1; i++) {
            await handleLaunch(
                { iss: settledBaseUrl(i), launch: 'launch-1' },
                baseDeps(depsWithRegistration(registerClient)),
            )
        }

        // Start, without awaiting, one more registration that stays in flight for the rest of
        // this test, filling the cache to its cap with the newest entry still pending.
        const inFlightLaunch = handleLaunch(
            { iss: inFlightBaseUrl, launch: 'launch-1' },
            baseDeps(depsWithRegistration(registerClient)),
        )
        // Give the in-flight launch a chance to reach the registration call and populate the
        // cache before the next launch below inspects it.
        await new Promise((resolve) => setTimeout(resolve, 0))

        // A further distinct FHIR base URL forces an eviction. The in-flight entry must survive
        // it; the oldest settled entry (index 0) is evicted instead.
        await handleLaunch(
            { iss: settledBaseUrl(MAX_DYNAMIC_REGISTRATIONS), launch: 'launch-1' },
            baseDeps(depsWithRegistration(registerClient)),
        )

        resolveInFlight({
            fhirBaseUrl: inFlightBaseUrl,
            clientId: 'dcr-client-inflight',
            auth: { type: 'public' },
            dynamicallyRegistered: true,
        })
        await inFlightLaunch

        const callsBeforeRecheck = registerClient.mock.calls.length

        // The in-flight (now resolved) entry was preserved: relaunching for it does not
        // re-register.
        await handleLaunch(
            { iss: inFlightBaseUrl, launch: 'launch-2' },
            baseDeps(depsWithRegistration(registerClient)),
        )
        expect(registerClient).toHaveBeenCalledTimes(callsBeforeRecheck)

        // The oldest settled entry (index 0) was evicted to make room, so it re-registers.
        await handleLaunch(
            { iss: settledBaseUrl(0), launch: 'launch-2' },
            baseDeps(depsWithRegistration(registerClient)),
        )
        expect(registerClient).toHaveBeenCalledTimes(callsBeforeRecheck + 1)
    })
})
