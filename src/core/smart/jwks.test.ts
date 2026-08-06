import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k']

async function freshJwksModule(): Promise<typeof import('./jwks')> {
    vi.resetModules()
    return await import('./jwks')
}

function assertNoPrivateMembers(jwk: Record<string, unknown>): void {
    for (const member of PRIVATE_JWK_MEMBERS) {
        expect(jwk).not.toHaveProperty(member)
    }
}

describe('jwks', () => {
    afterEach(() => {
        delete process.env.SMART_PRIVATE_JWK
        vi.resetModules()
    })

    describe('without SMART_PRIVATE_JWK configured', () => {
        it('generates an ephemeral key and publishes only its public material', async () => {
            delete process.env.SMART_PRIVATE_JWK
            const { getPublicJwks } = await freshJwksModule()

            const { keys } = await getPublicJwks()

            expect(keys).toHaveLength(1)
            const [jwk] = keys as [Record<string, unknown>]
            assertNoPrivateMembers(jwk)
            expect(jwk.kty).toBe('EC')
            expect(jwk.crv).toBe('P-384')
            expect(jwk.use).toBe('sig')
            expect(typeof jwk.kid).toBe('string')
        })

        it('reuses the same ephemeral identity across calls within a process', async () => {
            delete process.env.SMART_PRIVATE_JWK
            const { getPublicJwks, getSigningKey } = await freshJwksModule()

            const first = await getSigningKey()
            const second = await getSigningKey()
            const { keys } = await getPublicJwks()

            expect(second.kid).toBe(first.kid)
            expect(second.alg).toBe(first.alg)
            expect(keys[0]?.kid).toBe(first.kid)
        })

        it('produces a signing key that verifies against its own published JWKS', async () => {
            delete process.env.SMART_PRIVATE_JWK
            const { getPublicJwks, getSigningKey } = await freshJwksModule()

            const { key, kid, alg } = await getSigningKey()
            const jwt = await new SignJWT({ hello: 'world' })
                .setProtectedHeader({ alg, kid })
                .setIssuedAt()
                .setExpirationTime('5m')
                .sign(key)

            const { keys } = await getPublicJwks()
            const { importJWK } = await import('jose')
            const publicKey = await importJWK(keys[0] as never, alg)
            const { payload, protectedHeader } = await jwtVerify(jwt, publicKey as never)

            expect(protectedHeader.kid).toBe(kid)
            expect(protectedHeader.alg).toBe(alg)
            expect(payload.hello).toBe('world')
        })
    })

    describe('with SMART_PRIVATE_JWK configured', () => {
        it('loads the configured key and never leaks its private components', async () => {
            const { publicKey, privateKey } = await generateKeyPair('ES384', { extractable: true })
            const privateJwk = await exportJWK(privateKey)
            const publicJwkFromKeyPair = await exportJWK(publicKey)
            process.env.SMART_PRIVATE_JWK = JSON.stringify({
                ...privateJwk,
                kid: 'configured-kid',
                alg: 'ES384',
            })

            const { getPublicJwks, getSigningKey } = await freshJwksModule()

            const signingKey = await getSigningKey()
            expect(signingKey.kid).toBe('configured-kid')
            expect(signingKey.alg).toBe('ES384')

            const { keys } = await getPublicJwks()
            expect(keys).toHaveLength(1)
            const [jwk] = keys as [Record<string, unknown>]
            assertNoPrivateMembers(jwk)
            expect(jwk.kid).toBe('configured-kid')
            expect(jwk.crv).toBe(publicJwkFromKeyPair.crv)
            expect(jwk.x).toBe(publicJwkFromKeyPair.x)
            expect(jwk.y).toBe(publicJwkFromKeyPair.y)
        })

        it('rejects a configured value that is not an asymmetric private key', async () => {
            process.env.SMART_PRIVATE_JWK = JSON.stringify({ kty: 'oct', k: 'c2VjcmV0', alg: 'ES384' })

            const { getSigningKey } = await freshJwksModule()

            await expect(getSigningKey()).rejects.toThrow('must contain an asymmetric private key')
        })
    })
})
