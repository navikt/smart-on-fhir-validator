/**
 * This app's own signing identity, published as a JWKS for EHRs to fetch during dynamic client
 * registration and used for `private_key_jwt` client authentication.
 *
 * Read once from `SMART_PRIVATE_JWK`, or an ephemeral ES384 key pair when unset so local
 * development needs no configuration. An ephemeral key does not survive a restart, forcing any
 * EHR that pinned this app's public key to re-register (hence the warning, and hence not
 * acceptable outside local development).
 */

import { exportJWK, generateKeyPair, importJWK, type JWK } from 'jose'

import { logger } from '#core/logger'

const DEFAULT_ALGORITHM = 'ES384'
const DEFAULT_KEY_ID = 'smart-on-fhir-validator'

/** JWK members that only ever appear on a private key. Never let these reach `getPublicJwks`. */
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'] as const

type SigningAlgorithm = 'RS384' | 'ES384'

type SigningIdentity = {
    key: CryptoKey
    publicJwk: JWK
    kid: string
    alg: SigningAlgorithm
}

let identityPromise: Promise<SigningIdentity> | null = null

function getIdentity(): Promise<SigningIdentity> {
    identityPromise ??= loadOrGenerateIdentity()
    return identityPromise
}

function loadOrGenerateIdentity(): Promise<SigningIdentity> {
    const configured = process.env.SMART_PRIVATE_JWK
    if (configured) return loadConfiguredIdentity(configured)

    logger.warn(
        'SMART_PRIVATE_JWK is not set; generating an ephemeral ES384 key pair for asymmetric ' +
            'client authentication. This key will not survive a restart. Set SMART_PRIVATE_JWK ' +
            'in any environment where EHRs register against this app.',
    )
    return generateEphemeralIdentity()
}

async function loadConfiguredIdentity(json: string): Promise<SigningIdentity> {
    const jwk = JSON.parse(json) as JWK & { alg?: string; kid?: string }
    const alg = jwk.alg === 'RS384' || jwk.alg === 'ES384' ? jwk.alg : DEFAULT_ALGORITHM
    const kid = jwk.kid ?? DEFAULT_KEY_ID

    const key = await importJWK(jwk, alg)
    if (!(key instanceof CryptoKey)) {
        throw new Error('SMART_PRIVATE_JWK must contain an asymmetric private key, not a shared secret')
    }

    return { key, publicJwk: toPublicJwk(jwk, kid, alg), kid, alg }
}

async function generateEphemeralIdentity(): Promise<SigningIdentity> {
    const { publicKey, privateKey } = await generateKeyPair(DEFAULT_ALGORITHM, { extractable: true })
    const publicJwk = await exportJWK(publicKey)

    return {
        key: privateKey,
        publicJwk: { ...publicJwk, kid: DEFAULT_KEY_ID, alg: DEFAULT_ALGORITHM, use: 'sig' },
        kid: DEFAULT_KEY_ID,
        alg: DEFAULT_ALGORITHM,
    }
}

function toPublicJwk(jwk: JWK, kid: string, alg: string): JWK {
    const isPrivateMember = (key: string): boolean => (PRIVATE_JWK_MEMBERS as readonly string[]).includes(key)
    const publicMembers = Object.fromEntries(Object.entries(jwk).filter(([key]) => !isPrivateMember(key)))

    return { ...publicMembers, kid, alg, use: 'sig' }
}

export async function getSigningKey(): Promise<{ key: CryptoKey; kid: string; alg: SigningAlgorithm }> {
    const { key, kid, alg } = await getIdentity()
    return { key, kid, alg }
}

/** Public key material only, see the `PRIVATE_JWK_MEMBERS` filter and its test. */
export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
    const { publicJwk } = await getIdentity()
    return { keys: [publicJwk] }
}
