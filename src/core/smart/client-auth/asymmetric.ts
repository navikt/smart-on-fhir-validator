import { randomUUID } from 'node:crypto'

import { importJWK, SignJWT } from 'jose'

import type { ClientAuthentication } from './index'

/** RFC 7523 / SMART's client-confidential-asymmetric profile caps assertion lifetime tightly. */
const MAX_ASSERTION_LIFETIME_SECONDS = 5 * 60

export type AsymmetricAuthConfig = {
    /** This app's own private key, as a JSON-serialised JWK (see `#core/smart/jwks`). */
    privateKeyJwk: string
    keyId: string
    /** SMART's required baseline algorithms for `private_key_jwt`. */
    algorithm: 'RS384' | 'ES384'
}

/**
 * `private_key_jwt`: the client authenticates with a short-lived signed JWT assertion instead of
 * a shared secret.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/client-confidential-asymmetric.html
 */
export function createAsymmetricClientAuthentication(
    clientId: string,
    tokenEndpoint: string,
    config: AsymmetricAuthConfig,
): ClientAuthentication {
    return {
        method: 'private_key_jwt',
        formFields: async () => ({
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: await buildClientAssertion(clientId, tokenEndpoint, config),
        }),
        headers: async () => ({}),
    }
}

async function buildClientAssertion(
    clientId: string,
    tokenEndpoint: string,
    { privateKeyJwk, keyId, algorithm }: AsymmetricAuthConfig,
): Promise<string> {
    const key = await importJWK(JSON.parse(privateKeyJwk), algorithm)
    const issuedAt = Math.floor(Date.now() / 1000)

    return await new SignJWT({})
        .setProtectedHeader({ alg: algorithm, kid: keyId, typ: 'JWT' })
        .setIssuer(clientId)
        .setSubject(clientId)
        .setAudience(tokenEndpoint)
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setNotBefore(issuedAt)
        .setExpirationTime(issuedAt + MAX_ASSERTION_LIFETIME_SECONDS)
        .sign(key)
}
