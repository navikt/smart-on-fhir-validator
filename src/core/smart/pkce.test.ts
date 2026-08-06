import { describe, expect, it } from 'vitest'

import { computeCodeChallenge, createOauthState, createPkcePair } from './pkce'

describe('computeCodeChallenge', () => {
    it('matches the RFC 7636 Appendix B test vector exactly', () => {
        // https://datatracker.ietf.org/doc/html/rfc7636#appendix-B
        const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
        const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

        expect(computeCodeChallenge(codeVerifier)).toBe(expectedChallenge)
    })
})

describe('createPkcePair', () => {
    it('generates a verifier within the RFC 7636 length bounds using only unreserved characters', () => {
        const { codeVerifier } = createPkcePair()

        expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
        expect(codeVerifier.length).toBeLessThanOrEqual(128)
        expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
    })

    it('derives the challenge from the verifier using S256', () => {
        const pair = createPkcePair()

        expect(pair.method).toBe('S256')
        expect(pair.codeChallenge).toBe(computeCodeChallenge(pair.codeVerifier))
        // base64url, unpadded
        expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9\-_]+$/)
    })

    it('generates distinct pairs on each call', () => {
        const first = createPkcePair()
        const second = createPkcePair()

        expect(first.codeVerifier).not.toBe(second.codeVerifier)
        expect(first.codeChallenge).not.toBe(second.codeChallenge)
    })
})

describe('createOauthState', () => {
    it('generates a URL-safe, sufficiently long, non-repeating value', () => {
        const first = createOauthState()
        const second = createOauthState()

        expect(first).not.toBe(second)
        expect(first.length).toBeGreaterThanOrEqual(32)
        expect(first).toMatch(/^[A-Za-z0-9\-_]+$/)
    })
})
