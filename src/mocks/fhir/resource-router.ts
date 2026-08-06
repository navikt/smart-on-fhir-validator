import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

import type { FhirResource, OperationOutcome } from 'fhir/r4'

import { fhirJson, toSearchBundle } from './bundle-helpers'
import { operationOutcome } from './operation-outcome'

export type WriteOutcome<T> =
    | { ok: true; resource: T }
    | { ok: false; status: number; outcome: OperationOutcome }

export type ResourceRouterConfig<T extends FhirResource> = {
    resourceType: string
    baseUrl: string
    store: Map<string, T>
    /** One matcher per supported search parameter name. Any other query key is rejected. */
    searchParams?: Record<string, (resource: T, value: string) => boolean>
    onCreate?: (body: unknown) => WriteOutcome<T>
    onUpdate?: (id: string, body: unknown) => WriteOutcome<T>
    /** Bearer + scope enforcement, shared across every resource via `fhir/auth-middleware.ts`. */
    auth: MiddlewareHandler
}

/**
 * A generic FHIR resource endpoint: `GET /:id` (read), `GET /` (search), and optionally
 * `POST /` (create) and `PUT /:id` (update) when the resource supports writes.
 *
 * Kept generic so every resource behaves identically for the parts of the FHIR REST contract
 * that don't vary by resource type (searchset shape, unknown-parameter/unknown-id handling,
 * status codes) — resource-specific behaviour is only the search matchers and write validation.
 */
export function createResourceRouter<T extends FhirResource>(config: ResourceRouterConfig<T>): Hono {
    const { resourceType, baseUrl, store, searchParams = {}, onCreate, onUpdate, auth } = config
    const app = new Hono()

    app.use('*', auth)

    app.get('/:id', (c) => {
        const id = c.req.param('id')
        const resource = store.get(id)
        if (!resource) {
            return fhirJson(
                operationOutcome('error', 'not-found', `${resourceType}/${id} does not exist`),
                404,
            )
        }

        return fhirJson(resource)
    })

    app.get('/', (c) => {
        const query = c.req.query()
        const unsupported = Object.keys(query).filter((key) => !(key in searchParams))
        if (unsupported.length > 0) {
            return fhirJson(
                operationOutcome(
                    'error',
                    'not-supported',
                    `${resourceType} does not support the search parameter(s): ${unsupported.join(', ')}`,
                ),
                400,
            )
        }

        const matches = [...store.values()].filter((resource) =>
            Object.entries(query).every(([key, value]) => searchParams[key]?.(resource, value) ?? true),
        )

        return fhirJson(toSearchBundle(baseUrl, resourceType, matches))
    })

    if (onCreate) {
        app.post('/', async (c) => {
            const body: unknown = await c.req.json().catch(() => null)
            const result = onCreate(body)
            if (!result.ok) return fhirJson(result.outcome, result.status)

            const id = result.resource.id
            if (id) store.set(id, result.resource)

            return fhirJson(result.resource, 201, { Location: `${baseUrl}/${resourceType}/${id}` })
        })
    }

    if (onUpdate) {
        app.put('/:id', async (c) => {
            const id = c.req.param('id')
            const body: unknown = await c.req.json().catch(() => null)
            const result = onUpdate(id, body)
            if (!result.ok) return fhirJson(result.outcome, result.status)

            store.set(id, result.resource)
            return fhirJson(result.resource, 200)
        })
    }

    return app
}
