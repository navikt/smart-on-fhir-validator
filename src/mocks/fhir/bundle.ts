import type { Bundle, FhirResource } from 'fhir/r4'
import type { Context, Hono } from 'hono'

import type { MockState } from '#mocks/state'

import { fhirJson } from './bundle-helpers'
import { operationOutcome } from './operation-outcome'

type ResourceStores = MockState['resources']

const HTTP_STATUS_TEXT: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    422: 'Unprocessable Entity',
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function cloneMap<K, V>(source: Map<K, V>): Map<K, V> {
    return new Map(source)
}

function snapshotResources(resources: ResourceStores): ResourceStores {
    return {
        Patient: cloneMap(resources.Patient),
        Practitioner: cloneMap(resources.Practitioner),
        PractitionerRole: cloneMap(resources.PractitionerRole),
        Organization: cloneMap(resources.Organization),
        Encounter: cloneMap(resources.Encounter),
        Condition: cloneMap(resources.Condition),
        DocumentReference: cloneMap(resources.DocumentReference),
        Binary: cloneMap(resources.Binary),
        QuestionnaireResponse: cloneMap(resources.QuestionnaireResponse),
    }
}

function restoreOne<K, V>(target: Map<K, V>, snapshot: Map<K, V>): void {
    target.clear()
    for (const [key, value] of snapshot) target.set(key, value)
}

/**
 * Restores every store *in place* (clear + refill) rather than replacing the `Map` objects:
 * every resource router closed over the original `Map` reference at startup, so a rollback must
 * mutate those same instances.
 */
function restoreResources(resources: ResourceStores, snapshot: ResourceStores): void {
    restoreOne(resources.Patient, snapshot.Patient)
    restoreOne(resources.Practitioner, snapshot.Practitioner)
    restoreOne(resources.PractitionerRole, snapshot.PractitionerRole)
    restoreOne(resources.Organization, snapshot.Organization)
    restoreOne(resources.Encounter, snapshot.Encounter)
    restoreOne(resources.Condition, snapshot.Condition)
    restoreOne(resources.DocumentReference, snapshot.DocumentReference)
    restoreOne(resources.Binary, snapshot.Binary)
    restoreOne(resources.QuestionnaireResponse, snapshot.QuestionnaireResponse)
}

type DispatchResult = { status: number; body: unknown; location?: string }

/**
 * Dispatches a single Bundle entry back through the mock's own routing rather than duplicating
 * resource logic here: a batch/transaction entry behaves exactly like the equivalent standalone
 * HTTP request, including defects and scope enforcement.
 */
async function dispatchEntry(
    entry: unknown,
    state: MockState,
    app: Hono,
    authHeader: string | undefined,
): Promise<DispatchResult> {
    const record = asRecord(entry)
    const request = asRecord(record.request)
    const method = typeof request.method === 'string' ? request.method : 'GET'
    const url = typeof request.url === 'string' ? request.url : ''
    const fullUrl = `${state.baseUrl}/${url.replace(/^\//, '')}`

    const headers: Record<string, string> = { 'Content-Type': 'application/fhir+json' }
    if (authHeader) headers.Authorization = authHeader

    const init: RequestInit = { method, headers }
    if (record.resource !== undefined && method !== 'GET' && method !== 'DELETE') {
        init.body = JSON.stringify(record.resource)
    }

    const response = await app.fetch(new Request(fullUrl, init))
    const body: unknown = await response.json().catch(() => null)

    return { status: response.status, body, location: response.headers.get('Location') ?? undefined }
}

function buildResponseBundle(
    type: 'batch-response' | 'transaction-response',
    results: DispatchResult[],
): Bundle {
    return {
        resourceType: 'Bundle',
        type,
        entry: results.map((result) => ({
            ...(result.status < 300 ? { resource: result.body as FhirResource } : {}),
            response: {
                status: `${result.status} ${HTTP_STATUS_TEXT[result.status] ?? ''}`.trim(),
                ...(result.location ? { location: result.location } : {}),
                ...(result.status >= 400 ? { outcome: result.body as FhirResource } : {}),
            },
        })),
    }
}

export async function processBundle(c: Context, state: MockState, app: Hono): Promise<Response> {
    const body: unknown = await c.req.json().catch(() => null)
    const bundle = asRecord(body)
    const type = bundle.type

    if (type !== 'batch' && type !== 'transaction') {
        return fhirJson(
            operationOutcome('error', 'invalid', 'Bundle.type must be "batch" or "transaction"'),
            400,
        )
    }

    if (type === 'batch' && state.defects.has('bundle-transaction-only')) {
        return fhirJson(
            operationOutcome(
                'error',
                'not-supported',
                'This server only accepts transaction Bundles, not batch',
            ),
            400,
        )
    }

    const entries = Array.isArray(bundle.entry) ? bundle.entry : []
    const authHeader = c.req.header('Authorization')

    if (type === 'batch') {
        // Each entry is processed independently: one failing entry must not affect the others.
        const results = await Promise.all(
            entries.map((entry) => dispatchEntry(entry, state, app, authHeader)),
        )
        return fhirJson(buildResponseBundle('batch-response', results))
    }

    // Transaction: all-or-nothing. Snapshot first, and roll back every mutation if any entry failed.
    const snapshot = snapshotResources(state.resources)
    const results = await Promise.all(entries.map((entry) => dispatchEntry(entry, state, app, authHeader)))

    if (results.some((result) => result.status >= 400)) {
        restoreResources(state.resources, snapshot)
        return fhirJson(
            operationOutcome('error', 'processing', 'Transaction failed; no changes were applied'),
            400,
        )
    }

    return fhirJson(buildResponseBundle('transaction-response', results))
}
