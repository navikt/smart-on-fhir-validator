import { exportJWK, generateKeyPair, importJWK, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { negotiateAuthMethod, selectClientAuthentication } from './index'

const TOKEN_ENDPOINT = 'https://ehr.example.com/oauth/token'

describe('public client authentication', () => {
    it('sends only client_id in the body, no headers, no secret', async () => {
        const auth = selectClientAuthentication('client-123', { type: 'public' }, TOKEN_ENDPOINT)

        expect(auth.method).toBe('none')
        await expect(auth.formFields()).resolves.toEqual({ client_id: 'client-123' })
        await expect(auth.headers()).resolves.toEqual({})
    })
})

describe('symmetric client authentication', () => {
    it('client_secret_post sends client_id and client_secret as form fields, no headers', async () => {
        const auth = selectClientAuthentication(
            'client-123',
            { type: 'confidential-symmetric', method: 'client_secret_post', clientSecret: 's3cr3t' },
            TOKEN_ENDPOINT,
        )

        expect(auth.method).toBe('client_secret_post')
        await expect(auth.formFields()).resolves.toEqual({
            client_id: 'client-123',
            client_secret: 's3cr3t',
        })
        await expect(auth.headers()).resolves.toEqual({})
    })

    it('client_secret_basic sends no form fields and a correctly form-urlencoded Basic header', async () => {
        const auth = selectClientAuthentication(
            'client-123',
            { type: 'confidential-symmetric', method: 'client_secret_basic', clientSecret: 's3cr3t' },
            TOKEN_ENDPOINT,
        )

        expect(auth.method).toBe('client_secret_basic')
        await expect(auth.formFields()).resolves.toEqual({})

        const headers = await auth.headers()
        const expected = `Basic ${Buffer.from('client-123:s3cr3t').toString('base64')}`
        expect(headers.Authorization).toBe(expected)
    })

    it('form-urlencodes client_id and client_secret individually before joining with a colon (RFC 6749 §2.3.1)', async () => {
        // A client_id containing a colon would corrupt a naive `base64(id + ':' + secret)`
        // implementation — the decoded value must still split unambiguously on the *first* colon
        // after per-value form-encoding, because encodeURIComponent-style encoding of ':' happens
        // per RFC 6749 Appendix B (application/x-www-form-urlencoded).
        const clientId = 'id with space:and+plus'
        const clientSecret = 'secret&with=reserved chars'

        const auth = selectClientAuthentication(
            clientId,
            { type: 'confidential-symmetric', method: 'client_secret_basic', clientSecret },
            TOKEN_ENDPOINT,
        )
        const headers = await auth.headers()
        const authorization = headers.Authorization
        expect(authorization).toBeDefined()

        const decoded = Buffer.from((authorization as string).replace(/^Basic /, ''), 'base64').toString(
            'utf-8',
        )

        const expectedEncodedId = new URLSearchParams([['v', clientId]]).toString().slice('v='.length)
        const expectedEncodedSecret = new URLSearchParams([['v', clientSecret]]).toString().slice('v='.length)

        expect(decoded).toBe(`${expectedEncodedId}:${expectedEncodedSecret}`)
        // The encoded id must not contain a raw, un-encoded colon or space — otherwise the
        // separator would be ambiguous.
        expect(expectedEncodedId).not.toContain(' ')
        expect(expectedEncodedId).toContain('%3A') // ':' percent-encoded
    })
})

describe('asymmetric client authentication (private_key_jwt)', () => {
    it('builds a client assertion JWT that verifies against the public key, with every required claim', async () => {
        const { publicKey, privateKey } = await generateKeyPair('ES384', { extractable: true })
        const privateJwk = await exportJWK(privateKey)
        const publicJwk = await exportJWK(publicKey)

        const auth = selectClientAuthentication(
            'client-123',
            {
                type: 'confidential-asymmetric',
                privateKeyJwk: JSON.stringify(privateJwk),
                keyId: 'test-kid',
                algorithm: 'ES384',
            },
            TOKEN_ENDPOINT,
        )

        expect(auth.method).toBe('private_key_jwt')
        await expect(auth.headers()).resolves.toEqual({})

        const fields = await auth.formFields()
        expect(fields.client_assertion_type).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
        expect(fields.client_assertion).toBeDefined()

        const verificationKey = await importJWK(publicJwk, 'ES384')
        const { payload, protectedHeader } = await jwtVerify(
            fields.client_assertion as string,
            verificationKey,
        )

        expect(protectedHeader.alg).toBe('ES384')
        expect(protectedHeader.kid).toBe('test-kid')
        expect(payload.iss).toBe('client-123')
        expect(payload.sub).toBe('client-123')
        expect(payload.aud).toBe(TOKEN_ENDPOINT)
        expect(typeof payload.jti).toBe('string')
        expect((payload.jti as string).length).toBeGreaterThan(0)
        expect(payload.iat).toBeTypeOf('number')
        expect(payload.nbf).toBeTypeOf('number')
        expect(payload.exp).toBeTypeOf('number')

        const iat = payload.iat as number
        const exp = payload.exp as number
        expect(exp - iat).toBeLessThanOrEqual(5 * 60)
        expect(exp).toBeGreaterThan(iat)
    })

    it('generates a fresh jti and expiry on every call', async () => {
        const { privateKey } = await generateKeyPair('ES384', { extractable: true })
        const privateJwk = await exportJWK(privateKey)

        const auth = selectClientAuthentication(
            'client-123',
            {
                type: 'confidential-asymmetric',
                privateKeyJwk: JSON.stringify(privateJwk),
                keyId: 'test-kid',
                algorithm: 'ES384',
            },
            TOKEN_ENDPOINT,
        )

        const first = await auth.formFields()
        const second = await auth.formFields()

        expect(first.client_assertion).not.toBe(second.client_assertion)
    })
})

describe('negotiateAuthMethod', () => {
    it('warns when the configured method is not advertised by the EHR', () => {
        const result = negotiateAuthMethod(
            { type: 'confidential-symmetric', method: 'client_secret_basic', clientSecret: 'x' },
            ['client_secret_post', 'private_key_jwt'],
        )

        expect(result.method).toBe('client_secret_basic')
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]).toContain('client_secret_basic')
    })

    it('does not warn when the configured method is advertised', () => {
        const result = negotiateAuthMethod(
            { type: 'confidential-symmetric', method: 'client_secret_basic', clientSecret: 'x' },
            ['client_secret_basic'],
        )

        expect(result.warnings).toEqual([])
    })

    it('does not warn for public clients even when token_endpoint_auth_methods_supported is absent', () => {
        const result = negotiateAuthMethod({ type: 'public' }, undefined)

        expect(result.method).toBe('none')
        expect(result.warnings).toEqual([])
    })

    it('does not warn when the discovery document omits token_endpoint_auth_methods_supported', () => {
        const result = negotiateAuthMethod(
            { type: 'confidential-asymmetric', privateKeyJwk: '{}', keyId: 'k', algorithm: 'ES384' },
            undefined,
        )

        expect(result.method).toBe('private_key_jwt')
        expect(result.warnings).toEqual([])
    })
})
