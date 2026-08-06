import { afterEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = ['SMART_ISSUERS', 'TEST_CLIENT_SECRET', 'TEST_PRIVATE_JWK', 'OTHER_CLIENT_SECRET'] as const

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
        process.env.TEST_CLIENT_SECRET = 'super-secret'
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                method: 'client_secret_post',
                clientSecretEnv: 'TEST_CLIENT_SECRET',
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
        process.env.TEST_CLIENT_SECRET = 'super-secret'
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'Test EHR',
                issuer: 'https://ehr.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                clientSecretEnv: 'TEST_CLIENT_SECRET',
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
                clientSecretEnv: 'DOES_NOT_EXIST',
            },
        ])

        await expect(freshIssuersModule()).rejects.toThrow(/DOES_NOT_EXIST/)
    })

    it('loads an asymmetric issuer entry, deriving keyId and algorithm from the referenced JWK', async () => {
        clearEnv()
        process.env.TEST_PRIVATE_JWK = JSON.stringify({
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
                privateKeyJwkEnv: 'TEST_PRIVATE_JWK',
            },
        ])
        const { findIssuerConfig } = await freshIssuersModule()

        const config = findIssuerConfig('https://ehr.example.com/fhir')
        expect(config?.auth).toEqual({
            type: 'confidential-asymmetric',
            privateKeyJwk: process.env.TEST_PRIVATE_JWK,
            keyId: 'my-kid',
            algorithm: 'ES384',
        })
    })

    it('throws at load time when the asymmetric JWK is missing alg or uses an unsupported algorithm', async () => {
        clearEnv()
        process.env.TEST_PRIVATE_JWK = JSON.stringify({
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
                privateKeyJwkEnv: 'TEST_PRIVATE_JWK',
            },
        ])

        await expect(freshIssuersModule()).rejects.toThrow(/RS384.*ES384|ES384.*RS384/)
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
        process.env.TEST_CLIENT_SECRET = 'secret-1'
        process.env.OTHER_CLIENT_SECRET = 'secret-2'
        process.env.SMART_ISSUERS = JSON.stringify([
            {
                name: 'EHR One',
                issuer: 'https://one.example.com/fhir',
                clientId: 'client-1',
                authType: 'symmetric',
                clientSecretEnv: 'TEST_CLIENT_SECRET',
            },
            {
                name: 'EHR Two',
                issuer: 'https://two.example.com/fhir',
                clientId: 'client-2',
                authType: 'symmetric',
                clientSecretEnv: 'OTHER_CLIENT_SECRET',
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
})
