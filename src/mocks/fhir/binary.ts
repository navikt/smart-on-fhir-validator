import { randomUUID } from 'node:crypto'

import type { Context } from 'hono'

import type { Binary } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { operationOutcome } from './operation-outcome'
import { createResourceRouter, type WriteOutcome } from './resource-router'
import { requireBearerAuth } from './auth-middleware'

/** `application/fhir+json` and plain `application/json` both parse as FHIR JSON; anything else is a raw upload. */
const FHIR_JSON_CONTENT_TYPES = ['application/fhir+json', 'application/json']

/**
 * `POST`/`PUT` on Binary is the one place in FHIR R4 where the body need not be a FHIR resource
 * at all: "When binary data is written to the server (create/update - POST or PUT), the data is
 * accepted as is and treated as the content of a Binary" (https://hl7.org/fhir/R4/binary.html#rest).
 * A non-FHIR-JSON `Content-Type` therefore means the whole body is the artifact's bytes, not a
 * `{resourceType: "Binary", ...}` document — parse it into that shape here so `validateBinary`
 * downstream never has to know which upload mechanism produced it.
 */
async function parseBinaryBody(c: Context): Promise<unknown> {
    const contentType = c.req.header('Content-Type') ?? ''
    const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''

    if (FHIR_JSON_CONTENT_TYPES.includes(mediaType)) {
        return c.req.json().catch(() => null)
    }

    const bytes = await c.req.arrayBuffer()
    return {
        resourceType: 'Binary',
        contentType: mediaType,
        data: Buffer.from(bytes).toString('base64'),
    }
}

export function binaryRouter(state: MockState) {
    return createResourceRouter<Binary>({
        resourceType: 'Binary',
        baseUrl: state.baseUrl,
        store: state.resources.Binary,
        onCreate: (body) => validateBinary(body),
        parseBody: parseBinaryBody,
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
