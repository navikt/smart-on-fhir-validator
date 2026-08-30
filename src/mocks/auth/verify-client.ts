import { createLocalJWKSet, jwtVerify } from 'jose'

import type { MockState, RegisteredClient } from '#mocks/state'

export type ClientAuthResult =
    | { ok: true; client: RegisteredClient }
    | { ok: false; status: number; error: string; description: string }

const invalidClient = (description: string): ClientAuthResult => ({
    ok: false,
    status: 401,
    error: 'invalid_client',
    description,
})

/** Reverses the per-value `application/x-www-form-urlencoded` encoding used to build a Basic header. */
function formUrlDecode(value: string): string {
    return decodeURIComponent(value.replace(/\+/g, ' '))
}

function decodeBasicAuth(header: string): { clientId: string; clientSecret: string } | null {
    const [scheme, credentials] = header.split(' ')
    if (scheme !== 'Basic' || !credentials) return null

    const decoded = Buffer.from(credentials, 'base64').toString('utf-8')
    const separatorIndex = decoded.indexOf(':')
    if (separatorIndex === -1) return null

    return {
        clientId: formUrlDecode(decoded.slice(0, separatorIndex)),
        clientSecret: formUrlDecode(decoded.slice(separatorIndex + 1)),
    }
}

async function verifyPrivateKeyJwt(
    state: MockState,
    client: RegisteredClient,
    assertion: string,
): Promise<ClientAuthResult> {
    if (!client.jwks) {
        return invalidClient(
            `Client "${client.clientId}" has no registered JWKS to verify a private_key_jwt assertion`,
        )
    }

    try {
        const keySet = createLocalJWKSet(client.jwks)
        const { payload } = await jwtVerify(assertion, keySet, {
            issuer: client.clientId,
            subject: client.clientId,
            audience: `${state.baseUrl}/token`,
        })

        const jti = payload.jti
        if (!jti) return invalidClient('client_assertion is missing a jti claim')
        if (state.usedAssertionIds.has(jti))
            return invalidClient('client_assertion jti has already been used')

        state.usedAssertionIds.add(jti)
        return { ok: true, client }
    } catch (cause) {
        return invalidClient(
            `client_assertion failed verification: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
    }
}

/**
 * Identifies and authenticates the client making a token request (HTTP Basic, a client_secret
 * in the body, or a private_key_jwt assertion) and checks that mechanism against what that
 * client registered with (statically via config, or dynamically via `POST /register`).
 */
export async function identifyClient(
    state: MockState,
    params: Record<string, string>,
    authorizationHeader: string | undefined,
): Promise<ClientAuthResult> {
    if (authorizationHeader) {
        const basic = decodeBasicAuth(authorizationHeader)
        if (!basic) return invalidClient('Malformed Authorization header')

        const client = state.clients.get(basic.clientId)
        if (!client) return invalidClient(`Unknown client_id: ${basic.clientId}`)
        if (client.authMethod !== 'client_secret_basic') {
            return invalidClient(`Client "${client.clientId}" is not registered for client_secret_basic`)
        }
        if (client.clientSecret !== basic.clientSecret) return invalidClient('Invalid client secret')

        return { ok: true, client }
    }

    if (params.client_assertion_type === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') {
        const assertion = params.client_assertion
        if (!assertion) return invalidClient('Missing client_assertion')

        const clientId = decodeAssertionSubject(assertion)
        if (!clientId) return invalidClient('client_assertion is not a well-formed JWT')

        const client = state.clients.get(clientId)
        if (!client) return invalidClient(`Unknown client_id: ${clientId}`)
        if (client.authMethod !== 'private_key_jwt') {
            return invalidClient(`Client "${client.clientId}" is not registered for private_key_jwt`)
        }

        return verifyPrivateKeyJwt(state, client, assertion)
    }

    const clientId = params.client_id
    if (!clientId) return invalidClient('Missing client authentication')

    const client = state.clients.get(clientId)
    if (!client) return invalidClient(`Unknown client_id: ${clientId}`)

    if (client.authMethod === 'client_secret_post') {
        if (client.clientSecret !== params.client_secret) return invalidClient('Invalid client secret')
        return { ok: true, client }
    }

    if (client.authMethod !== 'public') {
        return invalidClient(`Client "${client.clientId}" must authenticate with ${client.authMethod}`)
    }

    return { ok: true, client }
}

/** Reads `sub` (== `iss` for this grant type) from an unverified JWT, just to know which client's JWKS to fetch. */
function decodeAssertionSubject(jwt: string): string | null {
    const parts = jwt.split('.')
    if (parts.length !== 3 || !parts[1]) return null

    try {
        const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
        if (typeof payload !== 'object' || payload === null) return null

        const sub = (payload as Record<string, unknown>).sub
        return typeof sub === 'string' ? sub : null
    } catch {
        return null
    }
}
