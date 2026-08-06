import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'

import { decodeIdTokenClaims, verifyIdToken } from './id-token'

const ISSUER = 'https://ehr.example.com'
const CLIENT_ID = 'client-123'
const JWKS_URI = 'https://ehr.example.com/jwks'

/** Builds a `SmartHttpClient` whose only reachable endpoint is the given JWKS URI. */
function httpClientServingJwks(jwks: { keys: JWK[] }): SmartHttpClient {
    const fetchImpl = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url !== JWKS_URI) return new Response('not found', { status: 404 })

        return new Response(JSON.stringify(jwks), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    }) as typeof fetch

    return new SmartHttpClient({ recorder: createExchangeRecorder(), fetchImpl })
}

async function signIdToken(
    payload: Record<string, unknown>,
    privateKey: CryptoKey,
    kid: string,
): Promise<string> {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'ES384', kid })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setSubject('practitioner-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
}

async function generateSigningKeys(): Promise<{ privateKey: CryptoKey; jwks: { keys: JWK[] }; kid: string }> {
    const kid = 'test-key-1'
    const { publicKey, privateKey } = await generateKeyPair('ES384', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    return { privateKey, jwks: { keys: [{ ...publicJwk, kid, alg: 'ES384', use: 'sig' }] }, kid }
}

describe('verifyIdToken', () => {
    it('verifies a correctly signed, non-expired token with matching issuer and audience', async () => {
        const { privateKey, jwks, kid } = await generateSigningKeys()
        const idToken = await signIdToken({}, privateKey, kid)
        const httpClient = httpClientServingJwks(jwks)

        const result = await verifyIdToken(idToken, {
            jwksUri: JWKS_URI,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            httpClient,
        })

        expect(result.status).toBe('verified')
        expect(result.problems).toEqual([])
        if (result.status !== 'verified') throw new Error('expected verified result')
        expect(result.claims.iss).toBe(ISSUER)
        expect(result.claims.aud).toBe(CLIENT_ID)
        expect(result.claims.sub).toBe('practitioner-1')
    })

    it('reports an expired token as a finding, not an exception, while still returning decoded claims', async () => {
        const { privateKey, jwks, kid } = await generateSigningKeys()
        const idToken = await new SignJWT({})
            .setProtectedHeader({ alg: 'ES384', kid })
            .setIssuer(ISSUER)
            .setAudience(CLIENT_ID)
            .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
            .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
            .sign(privateKey)
        const httpClient = httpClientServingJwks(jwks)

        const result = await verifyIdToken(idToken, {
            jwksUri: JWKS_URI,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            httpClient,
        })

        expect(result.status).toBe('failed')
        expect(result.problems).toHaveLength(1)
        expect(result.problems[0]).toMatch(/exp/i)
        expect(result.claims?.iss).toBe(ISSUER)
    })

    it('reports a wrong audience as a finding', async () => {
        const { privateKey, jwks, kid } = await generateSigningKeys()
        const idToken = await new SignJWT({})
            .setProtectedHeader({ alg: 'ES384', kid })
            .setIssuer(ISSUER)
            .setAudience('someone-elses-client-id')
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey)
        const httpClient = httpClientServingJwks(jwks)

        const result = await verifyIdToken(idToken, {
            jwksUri: JWKS_URI,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            httpClient,
        })

        expect(result.status).toBe('failed')
        expect(result.problems[0]).toMatch(/aud/i)
        expect(result.claims?.aud).toBe('someone-elses-client-id')
    })

    it('reports a wrong issuer as a finding', async () => {
        const { privateKey, jwks, kid } = await generateSigningKeys()
        const idToken = await new SignJWT({})
            .setProtectedHeader({ alg: 'ES384', kid })
            .setIssuer('https://not-the-ehr.example.com')
            .setAudience(CLIENT_ID)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey)
        const httpClient = httpClientServingJwks(jwks)

        const result = await verifyIdToken(idToken, {
            jwksUri: JWKS_URI,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            httpClient,
        })

        expect(result.status).toBe('failed')
        expect(result.problems[0]).toMatch(/iss/i)
    })

    it('reports a bad signature (e.g. a key not in the JWKS) as a finding', async () => {
        const { jwks } = await generateSigningKeys()
        const { privateKey: wrongKey } = await generateKeyPair('ES384', { extractable: true })
        const idToken = await signIdToken({}, wrongKey, 'test-key-1')
        const httpClient = httpClientServingJwks(jwks)

        const result = await verifyIdToken(idToken, {
            jwksUri: JWKS_URI,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            httpClient,
        })

        expect(result.status).toBe('failed')
        expect(result.problems).toHaveLength(1)
    })

    it('reports an invalid jwks_uri as a finding without making any request', async () => {
        const httpClient = httpClientServingJwks({ keys: [] })
        const idToken = await signIdToken({}, (await generateKeyPair('ES384')).privateKey, 'k')

        const result = await verifyIdToken(idToken, {
            jwksUri: 'not a url',
            issuer: ISSUER,
            clientId: CLIENT_ID,
            httpClient,
        })

        expect(result.status).toBe('failed')
        expect(result.problems[0]).toContain('jwks_uri')
    })

    it('never throws, even for a completely malformed id_token', async () => {
        const httpClient = httpClientServingJwks({ keys: [] })

        await expect(
            verifyIdToken('not-a-jwt', {
                jwksUri: JWKS_URI,
                issuer: ISSUER,
                clientId: CLIENT_ID,
                httpClient,
            }),
        ).resolves.toMatchObject({ status: 'failed' })
    })
})

describe('decodeIdTokenClaims', () => {
    it('decodes claims without verifying the signature', async () => {
        const { privateKey } = await generateKeyPair('ES384', { extractable: true })
        const idToken = await signIdToken({ fhirUser: 'Practitioner/1' }, privateKey, 'any-kid')

        const claims = decodeIdTokenClaims(idToken)

        expect(claims?.iss).toBe(ISSUER)
        expect(claims?.fhirUser).toBe('Practitioner/1')
    })

    it('returns null for a malformed token rather than throwing', () => {
        expect(decodeIdTokenClaims('not-a-jwt')).toBeNull()
        expect(decodeIdTokenClaims('')).toBeNull()
    })
})
