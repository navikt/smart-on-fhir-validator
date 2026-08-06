import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWTVerifyGetKey } from 'jose'
import { describe, expect, it } from 'vitest'

import { verifyIdToken, type IdTokenKeyResolver, type IdTokenVerificationResult } from '#core/smart/id-token'
import type { Severity } from '#validation/validation'

import { parseFhirReference, validateIdToken } from './id-token'

const ISSUER = 'https://ehr.example.com'
const CLIENT_ID = 'client-123'

async function generateKeys() {
    const { publicKey, privateKey } = await generateKeyPair('ES384', { extractable: true })
    return { publicKey, privateKey }
}

/** A `jwtVerify` key resolver backed by a single in-memory public key, no network involved. */
function keyResolverFor(publicKey: CryptoKey): IdTokenKeyResolver {
    const resolver: JWTVerifyGetKey = async () => publicKey
    return resolver
}

async function signToken(
    privateKey: CryptoKey,
    claims: Record<string, unknown>,
    overrides: { issuer?: string; audience?: string; expiresIn?: string; issuedAt?: number } = {},
): Promise<string> {
    let builder = new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES384' })
        .setIssuer(overrides.issuer ?? ISSUER)
        .setAudience(overrides.audience ?? CLIENT_ID)
        .setExpirationTime(overrides.expiresIn ?? '5m')
        .setSubject((claims.sub as string | undefined) ?? 'practitioner-1')

    builder =
        overrides.issuedAt !== undefined ? builder.setIssuedAt(overrides.issuedAt) : builder.setIssuedAt()

    return builder.sign(privateKey)
}

/** Runs the real core verification (against an in-memory key, so still hermetic) for a test token. */
function verify(idToken: string, keyResolver: IdTokenKeyResolver, issuer = ISSUER) {
    return verifyIdToken(idToken, { issuer, clientId: CLIENT_ID, keyResolver })
}

function bySeverity(validations: ReturnType<typeof validateIdToken>, severity: Severity) {
    return validations.filter((v) => v.severity === severity)
}

describe('parseFhirReference', () => {
    it('parses a relative reference', () => {
        expect(parseFhirReference('Practitioner/123')).toEqual({ resourceType: 'Practitioner', id: '123' })
    })

    it('parses an absolute URL reference', () => {
        expect(parseFhirReference('https://ehr.example.org/fhir/Practitioner/abc-123')).toEqual({
            resourceType: 'Practitioner',
            id: 'abc-123',
        })
    })

    it('returns null for a non-reference string', () => {
        expect(parseFhirReference('not a reference')).toBeNull()
        expect(parseFhirReference('')).toBeNull()
        expect(parseFhirReference('Practitioner/')).toBeNull()
    })
})

describe('validateIdToken — end-to-end signature verification (via core verifyIdToken)', () => {
    it('verifies a correctly signed token and reports OK findings, with fhirUser resolved', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, { fhirUser: 'Practitioner/1' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        expect(verification.status).toBe('verified')
        expect(bySeverity(results, 'ERROR')).toEqual([])
        expect(bySeverity(results, 'OK').length).toBeGreaterThan(0)
        expect(results.some((r) => r.message.includes('Practitioner/1'))).toBe(true)
    })

    it('reports an ERROR for a genuinely wrong signature (different key pair)', async () => {
        const { publicKey } = await generateKeys()
        const { privateKey: wrongPrivateKey } = await generateKeys()
        const idToken = await signToken(wrongPrivateKey, { fhirUser: 'Practitioner/1' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        const errors = bySeverity(results, 'ERROR')
        expect(errors).toHaveLength(1)
        expect(errors[0]?.message).toMatch(/verification/i)
    })

    it('reports an ERROR for a wrong issuer', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, {}, { issuer: 'https://not-the-ehr.example.com' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: false })

        expect(bySeverity(results, 'ERROR').some((e) => e.message.includes('iss'))).toBe(true)
    })

    it('reports an ERROR for a wrong audience', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, {}, { audience: 'someone-elses-client' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: false })

        expect(bySeverity(results, 'ERROR').some((e) => e.message.includes('aud'))).toBe(true)
    })

    it('reports an ERROR for an expired token', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(
            privateKey,
            {},
            { expiresIn: '-10s', issuedAt: Math.floor(Date.now() / 1000) - 3600 },
        )
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: false })

        expect(bySeverity(results, 'ERROR').some((e) => e.message.toLowerCase().includes('exp'))).toBe(true)
    })

    it('never leaks the raw token signature in a finding message', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, { fhirUser: 'Practitioner/1' })
        const signaturePart = idToken.split('.')[2]
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        expect(signaturePart).toBeDefined()
        for (const r of results) {
            expect(r.message).not.toContain(signaturePart as string)
        }
    })
})

describe('validateIdToken — malformed tokens and skipped verification', () => {
    it('returns [] when idToken is undefined', () => {
        const results = validateIdToken({
            idToken: undefined,
            verification: null,
            identityClaimRequested: true,
        })
        expect(results).toEqual([])
    })

    it('reports an ERROR without throwing for a non-JWS string', async () => {
        const { publicKey } = await generateKeys()
        const verification = await verify('not-a-jwt', keyResolverFor(publicKey))

        const results = validateIdToken({
            idToken: 'not-a-jwt',
            verification,
            identityClaimRequested: false,
        })

        expect(verification.status).toBe('failed')
        // Claims can't even be best-effort decoded for a non-JWS string, so only the failed
        // verification and missing-`sub` findings are reported — never a throw.
        expect(bySeverity(results, 'ERROR').length).toBeGreaterThanOrEqual(1)
        expect(bySeverity(results, 'ERROR').some((e) => e.message.match(/verification/i))).toBe(true)
    })

    it('reports an ERROR when verification could not even be attempted (e.g. no issuer)', async () => {
        const { privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, {})

        const results = validateIdToken({
            idToken,
            verification: null,
            verificationSkippedReason: 'the SMART configuration did not advertise an issuer',
            identityClaimRequested: false,
        })

        // The signature couldn't be checked, but claim-level analysis still runs against a
        // best-effort decode of the (unverified) token — `sub` is present, so it reports OK.
        const errors = bySeverity(results, 'ERROR')
        expect(errors).toHaveLength(1)
        expect(errors[0]?.message).toMatch(/issuer/)
        expect(bySeverity(results, 'OK').some((o) => o.message.includes('sub'))).toBe(true)
    })
})

describe('validateIdToken — fhirUser and profile claims', () => {
    it('reports an ERROR when fhirUser was requested but neither fhirUser nor profile is present', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, {})
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        expect(bySeverity(results, 'ERROR').some((e) => e.message.includes('fhirUser'))).toBe(true)
    })

    it('reports an ERROR when fhirUser is present but not a resolvable reference', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, { fhirUser: 'not a reference' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        expect(
            bySeverity(results, 'ERROR').some((e) => e.message.includes('not a resolvable reference')),
        ).toBe(true)
    })

    it('reports an ERROR when fhirUser references an unsupported resource type', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, { fhirUser: 'Observation/123' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        expect(
            bySeverity(results, 'ERROR').some((e) => e.message.includes('not a resolvable reference')),
        ).toBe(true)
    })

    it('reports INFO when only the deprecated profile claim is present', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, { profile: 'Practitioner/1' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        expect(bySeverity(results, 'INFO').some((i) => i.message.includes('profile'))).toBe(true)
        expect(bySeverity(results, 'ERROR')).toEqual([])
    })

    it('does not require fhirUser when identity scopes were not requested', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, {})
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: false })

        expect(bySeverity(results, 'ERROR')).toEqual([])
    })
})

describe('validateIdToken — nonce', () => {
    it('reports OK when the nonce matches', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, { nonce: 'abc123' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({
            idToken,
            verification,
            identityClaimRequested: false,
            sentNonce: 'abc123',
        })

        expect(bySeverity(results, 'ERROR')).toEqual([])
        expect(bySeverity(results, 'OK').some((o) => o.message.toLowerCase().includes('nonce'))).toBe(true)
    })

    it('reports an ERROR when the nonce does not match', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, { nonce: 'wrong-nonce' })
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({
            idToken,
            verification,
            identityClaimRequested: false,
            sentNonce: 'abc123',
        })

        expect(bySeverity(results, 'ERROR').some((e) => e.message.toLowerCase().includes('nonce'))).toBe(true)
    })

    it('reports an ERROR when a nonce was sent but not echoed back', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, {})
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({
            idToken,
            verification,
            identityClaimRequested: false,
            sentNonce: 'abc123',
        })

        expect(bySeverity(results, 'ERROR').some((e) => e.message.toLowerCase().includes('nonce'))).toBe(true)
    })

    it('does not complain when no nonce was sent and none was echoed', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const idToken = await signToken(privateKey, {})
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: false })

        expect(results.some((r) => r.message.toLowerCase().includes('nonce'))).toBe(false)
    })
})

describe('validateIdToken — RS256 key pair also works (algorithm-agnostic)', () => {
    it('verifies an RS384-signed token end to end', async () => {
        const { publicKey, privateKey } = await generateKeyPair('RS384', { extractable: true })
        const idToken = await new SignJWT({ fhirUser: 'Patient/9' })
            .setProtectedHeader({ alg: 'RS384' })
            .setIssuer(ISSUER)
            .setAudience(CLIENT_ID)
            .setSubject('patient-9')
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey)
        const verification = await verify(idToken, keyResolverFor(publicKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: true })

        expect(bySeverity(results, 'ERROR')).toEqual([])
        expect(results.some((r) => r.message.includes('Patient/9'))).toBe(true)
    })
})

// Sanity check that `importJWK`/`exportJWK` round-trip, in case a future test wants a JWKS-shaped
// key resolver instead of a bare CryptoKey.
describe('jose interop sanity check', () => {
    it('round-trips a public key through JWK export/import', async () => {
        const { publicKey, privateKey } = await generateKeys()
        const jwk = await exportJWK(publicKey)
        const imported = await importJWK(jwk, 'ES384')
        const idToken = await signToken(privateKey, {})
        const verification = await verify(idToken, keyResolverFor(imported as CryptoKey))

        const results = validateIdToken({ idToken, verification, identityClaimRequested: false })

        expect(bySeverity(results, 'ERROR')).toEqual([])
    })
})

// Exercises `IdTokenVerificationResult` being passed straight through with no re-derivation on the
// validation side — the type import doubles as a compile-time check that the two modules stay wired.
describe('validateIdToken — accepts a pre-computed IdTokenVerificationResult', () => {
    it('works with a manually constructed failed result', () => {
        const verification: IdTokenVerificationResult = {
            status: 'failed',
            claims: { sub: 'practitioner-1' },
            problems: ['boom'],
        }

        const results = validateIdToken({
            idToken: 'a.b.c',
            verification,
            identityClaimRequested: false,
        })

        expect(bySeverity(results, 'ERROR').some((e) => e.message.includes('boom'))).toBe(true)
    })
})
