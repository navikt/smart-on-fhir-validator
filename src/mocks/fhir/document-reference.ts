import { randomUUID } from 'node:crypto'

import type { Coding, DocumentReference } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { operationOutcome } from './operation-outcome'
import { referenceMatches } from './reference-match'
import { createResourceRouter, type WriteOutcome } from './resource-router'
import { requireBearerAuth } from './auth-middleware'

export function documentReferenceRouter(state: MockState) {
    const searchParams: Record<string, (resource: DocumentReference, value: string) => boolean> = {
        // Removing this entry (rather than special-casing the defect at query time) is enough:
        // the generic router already rejects any parameter it wasn't given a matcher for.
        ...(state.defects.has('document-reference-search-unsupported')
            ? {}
            : { subject: (resource, value) => referenceMatches(resource.subject?.reference, value) }),
        encounter: (resource, value) =>
            resource.context?.encounter?.some((ref) => referenceMatches(ref.reference, value)) ?? false,
        type: (resource, value) => matchesTokenSearch(resource.type?.coding, value),
    }

    return createResourceRouter<DocumentReference>({
        resourceType: 'DocumentReference',
        baseUrl: state.baseUrl,
        store: state.resources.DocumentReference,
        searchParams,
        onCreate: (body) => validateWrite(body, state),
        onUpdate: (id, body) => validateWrite({ ...asRecord(body), id }, state),
        auth: requireBearerAuth(state, 'DocumentReference'),
    })
}

function matchesTokenSearch(codings: readonly Coding[] | undefined, value: string): boolean {
    if (!codings) return false

    const [system, code] = value.includes('|') ? value.split('|') : [undefined, value]
    return codings.some(
        (coding) => (system === undefined || coding.system === system) && coding.code === code,
    )
}

function asRecord(body: unknown): Record<string, unknown> {
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

function validateWrite(body: unknown, state: MockState): WriteOutcome<DocumentReference> {
    const candidate = asRecord(body)
    if (candidate.resourceType !== undefined && candidate.resourceType !== 'DocumentReference') {
        return {
            ok: false,
            status: 422,
            outcome: operationOutcome('error', 'invalid', 'resourceType must be "DocumentReference"'),
        }
    }

    const content = candidate.content
    if (!Array.isArray(content) || content.length === 0) {
        return {
            ok: false,
            status: 422,
            outcome: operationOutcome('error', 'required', 'DocumentReference.content is required'),
        }
    }

    for (const entry of content) {
        const attachment = asRecord(entry).attachment
        const data =
            typeof asRecord(attachment).data === 'string' ? (asRecord(attachment).data as string) : undefined
        const url =
            typeof asRecord(attachment).url === 'string' ? (asRecord(attachment).url as string) : undefined

        if (!data && !url) {
            return {
                ok: false,
                status: 422,
                outcome: operationOutcome(
                    'error',
                    'required',
                    'content.attachment must include either inline "data" or a "url" reference',
                ),
            }
        }

        if (url && state.defects.has('document-reference-rejects-binary')) {
            return {
                ok: false,
                status: 422,
                outcome: operationOutcome(
                    'error',
                    'not-supported',
                    'This server does not accept content.attachment.url references to a Binary; provide inline base64 content.attachment.data instead',
                ),
            }
        }
    }

    const id = typeof candidate.id === 'string' ? candidate.id : randomUUID()
    return {
        ok: true,
        resource: { ...candidate, id, resourceType: 'DocumentReference' } as DocumentReference,
    }
}
