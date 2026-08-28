/**
 * Generates the ES384 key pair this app signs with, in the exact JSON shape `SMART_PRIVATE_JWK`
 * expects (see `src/core/smart/jwks.ts`).
 *
 * `ssh-keygen` and `openssl` produce PEM/OpenSSH, not a JWK, which would need a manual conversion
 * and a hand-edited JSON blob. `jose` is already a dependency and emits a JWK directly.
 *
 * Usage: `yarn generate-key`, then paste the single line of output into the
 * `smart-on-fhir-validator-clients` Kubernetes secret as `SMART_PRIVATE_JWK`. The private key (`d`)
 * never needs to leave that secret — `getPublicJwks()` derives the public JWKS served at
 * `/.well-known/jwks.json` from it at runtime.
 */

import { exportJWK, generateKeyPair } from 'jose'

const ALGORITHM = 'ES384'

async function main(): Promise<void> {
    const { privateKey } = await generateKeyPair(ALGORITHM, { extractable: true })
    const jwk = await exportJWK(privateKey)

    const kid = crypto.randomUUID()
    const smartPrivateJwk = { ...jwk, alg: ALGORITHM, kid, use: 'sig' }

    // oxlint-disable-next-line no-console
    console.log(JSON.stringify(smartPrivateJwk))
}

main()
