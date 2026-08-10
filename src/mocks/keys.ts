/**
 * The mock EHR's own signing identity, used to sign `id_token`s and published at
 * `.well-known/jwks.json` so a client under test can verify them the same way it would verify a
 * real EHR's tokens. One key pair per mock instance, so concurrent tests never share signing
 * state.
 */

import { exportJWK, generateKeyPair, type JWK } from 'jose'

const ALGORITHM = 'RS256'
const KEY_ID = 'mock-ehr-signing-key'

export type MockSigningIdentity = {
    alg: typeof ALGORITHM
    kid: typeof KEY_ID
    privateKey: CryptoKey
    jwks: { keys: JWK[] }
}

export async function createMockSigningIdentity(): Promise<MockSigningIdentity> {
    const { publicKey, privateKey } = await generateKeyPair(ALGORITHM, { extractable: true })
    const publicJwk = await exportJWK(publicKey)

    return {
        alg: ALGORITHM,
        kid: KEY_ID,
        privateKey,
        jwks: { keys: [{ ...publicJwk, kid: KEY_ID, alg: ALGORITHM, use: 'sig' }] },
    }
}
