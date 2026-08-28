import { afterEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = [
    'SMART_ISSUERS',
    'SMART_CLIENT_SECRET_TEST',
    'SMART_PRIVATE_JWK',
    'SMART_CLIENT_SECRET_OTHER',
] as const

async function freshIssuersModule(): Promise<typeof import('./issuers')> {
    vi.resetModules()
    return await import('./issuers')
}

function clearEnv(): void {
    for (const key of ENV_KEYS) delete process.env[key]
}

describe('config/issuers', () => {
    afterEach(() => {
        clearEnv()
        vi.resetModules()
    })

    it('returns no known issuers when SMART_ISSUERS is unset', async () => {
        clearEnv()
        const { findIssuerConfig, isKnownIssuer } = await freshIssuersModule()

        expect(findIssuerConfig('https://ehr.example.com/fhir')).toBeNull()
        expect(isKnownIssuer('https://ehr.example.com/fhir')).toBe(false)
    })

    it('loads a public issuer entry', async () => {
        clearEnv()
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'public',
            },
        ])
        const { findIssuerConfig } = await freshIssuersModule()

        const config = findIssuerConfig('https://ehr.example.com/fhir')
        expect(config).toEqual({
            issuer: 'https://ehr.example.com/fhir',
            clientId: 'client-1',
            auth: { type: 'public' },
            dynamicallyRegistered: false,
        })
    })

    it('reads the symmetric client secret from the named environment variable, not from SMART_ISSUERS', async () => {
        clearEnv()
        process.env.SMART_CLIENT_SECRET_TEST = 'super-secret'
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                method: 'client_secret_post',
                clientSecretEnv: 'SMART_CLIENT_SECRET_TEST',
            },
        ])
        const { findIssuerConfig } = await freshIssuersModule()

        const config = findIssuerConfig('https://ehr.example.com/fhir')
        expect(config?.auth).toEqual({
            type: 'confidential-symmetric',
            method: 'client_secret_post',
            clientSecret: 'super-secret',
        })
        // The secret itself must never appear in the SMART_ISSUERS blob.
        expect(process.env.SMART_ISSUERS).not.toContain('super-secret')
    })

    it('defaults the symmetric method to client_secret_basic when omitted', async () => {
        clearEnv()
        process.env.SMART_CLIENT_SECRET_TEST = 'super-secret'
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                clientSecretEnv: 'SMART_CLIENT_SECRET_TEST',
            },
        ])
        const { findIssuerConfig } = await freshIssuersModule()

        const config = findIssuerConfig('https://ehr.example.com/fhir')
        expect(config?.auth).toMatchObject({ method: 'client_secret_basic' })
    })

    it('throws at load time when a referenced secret environment variable is missing', async () => {
        clearEnv()
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                clientSecretEnv: 'SMART_CLIENT_SECRET_MISSING',
            },
        ])

        await expect(freshIssuersModule()).rejects.toThrow(/SMART_CLIENT_SECRET_MISSING/)
    })

    it('rejects a clientSecretEnv that does not match the SMART_CLIENT_SECRET_<NAME> pattern', async () => {
        clearEnv()
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                // A PR-contributed entry must not be able to name an unrelated secret.
                clientSecretEnv: 'SMART_PRIVATE_JWK',
            },
        ])

        await expect(freshIssuersModule()).rejects.toThrow(/SMART_ISSUERS is invalid/)
    })

    it('loads an asymmetric issuer entry from this app own SMART_PRIVATE_JWK, deriving keyId and algorithm', async () => {
        clearEnv()
        process.env.SMART_PRIVATE_JWK = JSON.stringify({
            kty: 'EC',
            crv: 'P-384',
            kid: 'my-kid',
            alg: 'ES384',
        })
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'asymmetric',
            },
        ])
        const { findIssuerConfig } = await freshIssuersModule()

        const config = findIssuerConfig('https://ehr.example.com/fhir')
        expect(config?.auth).toEqual({
            type: 'confidential-asymmetric',
            privateKeyJwk: process.env.SMART_PRIVATE_JWK,
            keyId: 'my-kid',
            algorithm: 'ES384',
        })
    })

    it('throws at load time when the asymmetric JWK is missing alg or uses an unsupported algorithm', async () => {
        clearEnv()
        process.env.SMART_PRIVATE_JWK = JSON.stringify({
            kty: 'EC',
            crv: 'P-384',
            kid: 'my-kid',
            alg: 'ES256',
        })
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'asymmetric',
            },
        ])

        await expect(freshIssuersModule()).rejects.toThrow(/RS384.*ES384|ES384.*RS384/)
    })

    it('rejects an asymmetric entry that still carries the removed privateKeyJwkEnv field', async () => {
        clearEnv()
        process.env.SMART_PRIVATE_JWK = JSON.stringify({
            kty: 'EC',
            crv: 'P-384',
            kid: 'my-kid',
            alg: 'ES384',
        })
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'asymmetric',
                privateKeyJwkEnv: 'SOME_OTHER_VAR',
            },
        ])

        // A stale privateKeyJwkEnv must be a hard error, not silently ignored, so a leftover
        // legacy field doesn't quietly point at the wrong key without anyone noticing.
        await expect(freshIssuersModule()).rejects.toThrow(/privateKeyJwkEnv/)
    })

    it('throws at load time when SMART_ISSUERS is not valid JSON', async () => {
        clearEnv()
        process.env.SMART_ISSUERS = '{not json'

        await expect(freshIssuersModule()).rejects.toThrow(/not valid JSON/)
    })

    it('throws at load time when an entry fails schema validation', async () => {
        clearEnv()
        process.env.SMART_ISSUERS = JSON.stringify([{ name: 'Test EHR', authType: 'public' }])

        await expect(freshIssuersModule()).rejects.toThrow(/SMART_ISSUERS is invalid/)
    })

    it('matches issuer URLs ignoring trailing slash and host case, but not path case', async () => {
        clearEnv()
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://EHR.example.com/fhir/Tenant1',
                clientId: 'client-1',
                authType: 'public',
            },
        ])
        const { findIssuerConfig, isKnownIssuer } = await freshIssuersModule()

        expect(findIssuerConfig('https://ehr.example.com/fhir/Tenant1/')).not.toBeNull()
        expect(findIssuerConfig('https://ehr.EXAMPLE.com/fhir/Tenant1')).not.toBeNull()
        expect(isKnownIssuer('https://ehr.example.com/fhir/tenant1')).toBe(false)
    })

    it('supports multiple issuer entries and only reads the secret for the one being matched', async () => {
        clearEnv()
        process.env.SMART_CLIENT_SECRET_TEST = 'secret-1'
        process.env.SMART_CLIENT_SECRET_OTHER = 'secret-2'
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'EHR One',
                issuer: 'https://one.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                clientSecretEnv: 'SMART_CLIENT_SECRET_TEST',
            },
            {
                name: 'EHR Two',
                issuer: 'https://two.example.com/fhir',
                clientId: 'client-2',
                authType: 'symmetric',
                clientSecretEnv: 'SMART_CLIENT_SECRET_OTHER',
            },
        ])
        const { findIssuerConfig } = await freshIssuersModule()

        expect(findIssuerConfig('https://one.example.com/fhir')?.auth).toMatchObject({
            clientSecret: 'secret-1',
        })
        expect(findIssuerConfig('https://two.example.com/fhir')?.auth).toMatchObject({
            clientSecret: 'secret-2',
        })
        expect(findIssuerConfig('https://three.example.com/fhir')).toBeNull()
    })

    it('throws at load time when two entries reference the same clientSecretEnv', async () => {
        clearEnv()
        process.env.SMART_CLIENT_SECRET_TEST = 'secret-1'
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'EHR One',
                issuer: 'https://one.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                clientSecretEnv: 'SMART_CLIENT_SECRET_TEST',
            },
            {
                // A malicious or careless PR could otherwise claim EHR One's already-provisioned
                // secret for a second, unrelated issuer and have it sent to that issuer's own
                // token endpoint.
                name: 'EHR Two',
                issuer: 'https://two.example.com/fhir',
                clientId: 'client-2',
                authType: 'symmetric',
                clientSecretEnv: 'SMART_CLIENT_SECRET_TEST',
            },
        ])

        await expect(freshIssuersModule()).rejects.toThrow(/same clientSecretEnv/)
    })

    it('throws at load time when two entries register the same issuer', async () => {
        clearEnv()
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'EHR One',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'public',
            },
            {
                name: 'EHR One Again',
                issuer: 'https://ehr.example.com/fhir/',
                clientId: 'client-2',
                authType: 'public',
            },
        ])

        // A duplicate issuer would let a spoofed discovery document be matched against either
        // entry's credentials — see credentialOriginIsAuthorized in #core/smart/callback.
        await expect(freshIssuersModule()).rejects.toThrow(/same issuer/)
    })
})
