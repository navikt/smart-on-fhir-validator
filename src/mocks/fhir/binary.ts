import { randomUUID } from 'node:crypto'

import type { Binary } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { operationOutcome } from './operation-outcome'
import { createResourceRouter, type WriteOutcome } from './resource-router'
import { requireBearerAuth } from './auth-middleware'

export function binaryRouter(state: MockState) {
    return createResourceRouter<Binary>({
        resourceType: 'Binary',
        baseUrl: state.baseUrl,
        store: state.resources.Binary,
        onCreate: (body) => validateBinary(body),
        auth: requireBearerAuth(state, 'Binary'),
    })
}

function validateBinary(body: unknown): WriteOutcome<Binary> {
    const candidate = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    if (candidate.resourceType !== undefined && candidate.resourceType !== 'Binary') {
        return {
            ok: false,
            status: 422,
            outcome: operationOutcome('error', 'invalid', 'resourceType must be "Binary"'),
        }
    }

    if (typeof candidate.contentType !== 'string' || typeof candidate.data !== 'string') {
        return {
            ok: false,
            status: 422,
            outcome: operationOutcome('error', 'required', 'Binary.contentType and Binary.data are required'),
        }
    }

    const id = typeof candidate.id === 'string' ? candidate.id : randomUUID()
    return {
        ok: true,
        resource: { resourceType: 'Binary', id, contentType: candidate.contentType, data: candidate.data },
    }
}
