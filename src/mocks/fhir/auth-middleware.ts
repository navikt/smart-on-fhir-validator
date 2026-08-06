import type { Context, MiddlewareHandler } from 'hono'

import type { AccessTokenRecord, MockState } from '#mocks/state'
import { scopeGrants, type FhirInteraction } from '#mocks/scopes'

import { fhirJson } from './bundle-helpers'
import { operationOutcome } from './operation-outcome'

function interactionFor(method: string): FhirInteraction {
    return method === 'GET' || method === 'HEAD' ? 'read' : 'write'
}

function readBearerToken(c: Context, state: MockState): AccessTokenRecord | Response {
    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!token) {
        return fhirJson(
            operationOutcome('error', 'security', 'Missing or malformed Authorization: Bearer header'),
            401,
        )
    }

    const record = state.accessTokens.get(token)
    if (!record || record.expiresAt < Date.now()) {
        return fhirJson(operationOutcome('error', 'security', 'Access token is invalid or expired'), 401)
    }

    return record
}

/** Requires a valid Bearer token but does not check scope — for the batch/transaction root. */
export function requireValidBearerToken(state: MockState): MiddlewareHandler {
    return async (c, next) => {
        const result = readBearerToken(c, state)
        if (result instanceof Response) return result

        await next()
    }
}

/** Requires a valid Bearer token AND that its granted scopes cover this interaction on `resourceType`. */
export function requireBearerAuth(state: MockState, resourceType: string): MiddlewareHandler {
    return async (c, next) => {
        const result = readBearerToken(c, state)
        if (result instanceof Response) return result

        const interaction = interactionFor(c.req.method)
        if (!scopeGrants(result.scope, resourceType, interaction)) {
            return fhirJson(
                operationOutcome(
                    'error',
                    'forbidden',
                    `Granted scopes do not permit ${interaction} access to ${resourceType}`,
                ),
                403,
            )
        }

        await next()
    }
}
