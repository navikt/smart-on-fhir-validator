import { randomUUID } from 'node:crypto'

import type { Context } from 'hono'
import type { JSONWebKeySet } from 'jose'

import type { MockClientAuthMethod, MockState } from '#mocks/state'

const VALID_AUTH_METHODS: readonly MockClientAuthMethod[] = [
    'public',
    'client_secret_basic',
    'client_secret_post',
    'private_key_jwt',
]

function isValidAuthMethod(value: unknown): value is MockClientAuthMethod {
    return typeof value === 'string' && (VALID_AUTH_METHODS as readonly string[]).includes(value)
}

function isJwks(value: unknown): value is JSONWebKeySet {
    return typeof value === 'object' && value !== null && Array.isArray((value as { keys?: unknown }).keys)
}

/**
 * RFC 7591 Dynamic Client Registration. Only inline `jwks` is accepted for `private_key_jwt`
 * clients (not `jwks_uri`) so the mock never needs a network round trip to verify a client
 * assertion — every test stays in-process.
 */
export function registerHandler(state: MockState) {
    return async (c: Context): Promise<Response> => {
        const body: unknown = await c.req.json().catch(() => null)
        const request = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

        const requestedAuthMethod = request.token_endpoint_auth_method
        const authMethod = isValidAuthMethod(requestedAuthMethod) ? requestedAuthMethod : 'public'

        if (authMethod === 'private_key_jwt' && !isJwks(request.jwks)) {
            return c.json(
                {
                    error: 'invalid_client_metadata',
                    error_description: 'private_key_jwt registration requires an inline "jwks"',
                },
                400,
            )
        }

        const clientId = randomUUID()
        const clientSecret =
            authMethod === 'client_secret_basic' || authMethod === 'client_secret_post'
                ? randomUUID()
                : undefined

        const redirectUris = Array.isArray(request.redirect_uris)
            ? request.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
            : undefined

        state.clients.set(clientId, {
            clientId,
            authMethod,
            clientSecret,
            jwks: isJwks(request.jwks) ? request.jwks : undefined,
            redirectUris,
        })

        return c.json(
            {
                client_id: clientId,
                client_id_issued_at: Math.floor(Date.now() / 1000),
                token_endpoint_auth_method: authMethod,
                ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
                ...(redirectUris ? { redirect_uris: redirectUris } : {}),
                ...(isJwks(request.jwks) ? { jwks: request.jwks } : {}),
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
            },
            201,
        )
    }
}
