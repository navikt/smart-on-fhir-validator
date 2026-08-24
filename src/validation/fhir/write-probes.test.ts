import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'
import type { ProbeContext } from '#validation/fhir/probe'
import { describe, expect, it } from 'vitest'

import {
    binaryWriteProbe,
    bundleBatchWriteProbe,
    documentReferenceBinaryWriteProbe,
    documentReferenceInlineWriteProbe,
    questionnaireResponseWriteProbe,
    testHelpers,
} from './write-probes'

const BASE_URL = 'https://ehr.example.com/fhir'

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }

type StoredResource = Record<string, unknown> & { id?: string }

function stubFetch(handler: (call: Call) => Response | Promise<Response>): {
    fetchImpl: typeof fetch
    calls: Call[]
} {
    const calls: Call[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const headers = (init?.headers ?? {}) as Record<string, string>
        const body = typeof init?.body === 'string' ? (tryParseJson(init.body) ?? init.body) : null
        const call: Call = { method: init?.method ?? 'GET', url, headers, body }
        calls.push(call)
        return handler(call)
    }) as typeof fetch
    return { fetchImpl, calls }
}

/**
 * A minimal in-memory FHIR server with the update-as-create semantics these tests assert: `PUT`
 * returns 201 the first time and 200 once the id exists, `POST` assigns a server id, `GET` reads
 * one resource or a `searchset`. `onRead` simulates a server that mutates a resource between
 * writing it and reading it back.
 */
function createFakeFhirServer(options: { onRead?: (resource: StoredResource) => StoredResource } = {}): {
    fetchImpl: typeof fetch
    calls: Call[]
} {
    const store = new Map<string, StoredResource>()
    const calls: Call[] = []

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        const headers = (init?.headers ?? {}) as Record<string, string>
        const rawBody = init?.body
        const parsedBody = typeof rawBody === 'string' ? tryParseJson(rawBody) : null
        calls.push({ method, url, headers, body: parsedBody })

        const withoutBase = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url
        const [pathPart = ''] = withoutBase.split('?')
        const segments = pathPart.split('/').filter((segment) => segment.length > 0)
        const [resourceType, id] = segments

        if (method === 'PUT' && resourceType !== undefined && id !== undefined) {
            const key = `${resourceType}/${id}`
            const existed = store.has(key)
            const resource: StoredResource = { ...(isRecord(parsedBody) ? parsedBody : {}), id }
            store.set(key, resource)
            return jsonResponse(resource, {
                status: existed ? 200 : 201,
                headers: existed ? {} : { Location: `${BASE_URL}/${key}` },
            })
        }

        if (method === 'POST' && resourceType !== undefined && id === undefined) {
            const assignedId = `server-assigned-${store.size + 1}`
            const key = `${resourceType}/${assignedId}`
            let resource: StoredResource
            if (isRecord(parsedBody)) {
                resource = { ...parsedBody, id: assignedId }
            } else if (resourceType === 'Binary') {
                const contentType =
                    headers['Content-Type'] ?? headers['content-type'] ?? 'application/octet-stream'
                const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))
                resource = {
                    resourceType: 'Binary',
                    id: assignedId,
                    contentType,
                    data: bytes.toString('base64'),
                }
            } else {
                resource = { id: assignedId }
            }
            store.set(key, resource)
            return jsonResponse(resource, { status: 201, headers: { Location: `${BASE_URL}/${key}` } })
        }

        if (method === 'GET' && resourceType !== undefined && id !== undefined) {
            const resource = store.get(`${resourceType}/${id}`)
            if (!resource) return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 404 })
            return jsonResponse(options.onRead ? options.onRead(resource) : resource)
        }

        if (method === 'GET' && resourceType !== undefined && id === undefined) {
            const matches = [...store.entries()]
                .filter(([key]) => key.startsWith(`${resourceType}/`))
                .map(([, resource]) => resource)
            return jsonResponse({
                resourceType: 'Bundle',
                type: 'searchset',
                entry: matches.map((resource) => ({ resource })),
            })
        }

        return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 404 })
    }) as typeof fetch

    return { fetchImpl, calls }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object'
}

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    })
}

function buildContext(fetchImpl: typeof fetch, launchOverrides: Partial<LaunchContext> = {}): ProbeContext {
    const recorder = createExchangeRecorder()
    const http = new SmartHttpClient({ recorder, fetchImpl })
    const fhir = new FhirClient({ http, baseUrl: BASE_URL, accessToken: 'token-abc' })
    const launch: LaunchContext = {
        patientId: 'patient-1',
        encounterId: 'encounter-1',
        fhirUser: 'Practitioner/practitioner-1',
        practitionerId: 'practitioner-1',
        grantedScopes: [
            'patient/DocumentReference.write',
            'patient/QuestionnaireResponse.write',
            'patient/Binary.write',
        ],
        ...launchOverrides,
    }
    return { fhir, launch }
}

function bad(validations: { severity: string }[]): { severity: string }[] {
    return validations.filter((v) => v.severity !== 'OK' && v.severity !== 'INFO')
}

describe('grantsWriteScope', () => {
    const launch: LaunchContext = {
        patientId: 'p',
        encounterId: 'e',
        fhirUser: null,
        practitionerId: null,
        grantedScopes: ['patient/DocumentReference.write'],
    }

    it('recognises the SMART v1 form', () => {
        expect(testHelpers.grantsWriteScope(launch, 'DocumentReference')).toBe(true)
    })

    it('recognises the SMART v2 cruds form', () => {
        const v2: LaunchContext = { ...launch, grantedScopes: ['patient/DocumentReference.cruds'] }
        expect(testHelpers.grantsWriteScope(v2, 'DocumentReference')).toBe(true)
    })

    it('rejects a read-only scope', () => {
        const readOnly: LaunchContext = { ...launch, grantedScopes: ['patient/DocumentReference.rs'] }
        expect(testHelpers.grantsWriteScope(readOnly, 'DocumentReference')).toBe(false)
    })

    it('rejects a scope for a different resource type', () => {
        expect(testHelpers.grantsWriteScope(launch, 'Binary')).toBe(false)
    })
})

describe('documentReferenceInlineWriteProbe', () => {
    it('skips cleanly when launch context is missing patient/encounter', async () => {
        const { fetchImpl } = stubFetch(() => jsonResponse({}))
        const context = buildContext(fetchImpl, { patientId: null })

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(outcome.skipped).toBeDefined()
        expect(outcome.exchangeId).toBeNull()
        expect(outcome.validations).toEqual([])
    })

    it('PUTs to [base]/DocumentReference/{client-assigned-id} twice with context.encounter set, then reads back and searches by subject and encounter', async () => {
        const { fetchImpl, calls } = createFakeFhirServer()
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])
        expect(outcome.skipped).toBeUndefined()

        const putCalls = calls.filter((c) => c.method === 'PUT')
        expect(putCalls).toHaveLength(2)
        expect(putCalls[0]?.url).toMatch(/\/DocumentReference\/smart-on-fhir-validator-docref-inline-/)
        expect(putCalls[0]?.url).toBe(putCalls[1]?.url)
        expect(putCalls[0]?.headers['Content-Type']).toBe('application/fhir+json')
        expect(putCalls[0]?.headers['Authorization']).toBe('Bearer token-abc')

        const sentBody = putCalls[0]?.body as {
            context?: { encounter?: { reference: string }[] }
            subject?: { reference: string }
        }
        expect(sentBody.context?.encounter?.[0]?.reference).toBe('Encounter/encounter-1')
        expect(sentBody.subject?.reference).toBe('Patient/patient-1')

        const subjectSearch = calls.find((c) => c.url.includes('subject='))
        expect(subjectSearch?.url).toBe(`${BASE_URL}/DocumentReference?subject=Patient%2Fpatient-1`)
        const encounterSearch = calls.find((c) => c.url.includes('encounter='))
        expect(encounterSearch?.url).toBe(`${BASE_URL}/DocumentReference?encounter=Encounter%2Fencounter-1`)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'OK' && v.message.includes('did not produce a different resource id'),
            ),
        ).toBe(true)
    })

    it('treats a 403 as correct behaviour when no write scope was granted', async () => {
        const { fetchImpl, calls } = stubFetch(() =>
            jsonResponse({ resourceType: 'OperationOutcome' }, { status: 403 }),
        )
        const context = buildContext(fetchImpl, { grantedScopes: [] })

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(calls).toHaveLength(1)
        expect(calls[0]?.method).toBe('PUT')
        expect(bad(outcome.validations)).toEqual([])
        expect(
            outcome.validations.some((v) => v.severity === 'OK' && v.message.includes('correctly rejected')),
        ).toBe(true)
    })

    it('errors when the server accepts a write despite no granted scope', async () => {
        const { fetchImpl } = stubFetch(() =>
            jsonResponse({ resourceType: 'DocumentReference', id: 'x' }, { status: 201 }),
        )
        const context = buildContext(fetchImpl, { grantedScopes: [] })

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'ERROR' && v.message.includes('must enforce granted scopes'),
            ),
        ).toBe(true)
    })

    it('errors when a repeated PUT with the same id returns a different resource id (idempotency violation)', async () => {
        let putCount = 0
        const { fetchImpl } = stubFetch((call) => {
            if (call.method === 'PUT') {
                putCount += 1
                const idFromUrl = call.url.split('/').pop() ?? ''
                const id = putCount === 1 ? idFromUrl : 'a-completely-different-id'
                return jsonResponse({ resourceType: 'DocumentReference', id }, { status: 201 })
            }
            return jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [] })
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'ERROR' && v.message.includes('produced a different resource id'),
            ),
        ).toBe(true)
    })

    it('warns when a repeated PUT unexpectedly returns 201 again instead of 200', async () => {
        const { fetchImpl } = stubFetch((call) => {
            if (call.method === 'PUT') {
                const id = call.url.split('/').pop() ?? ''
                return jsonResponse({ resourceType: 'DocumentReference', id }, { status: 201 })
            }
            return jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [] })
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) =>
                    v.severity === 'WARNING' &&
                    v.message.includes('Second PUT') &&
                    v.message.includes('201 Created again'),
            ),
        ).toBe(true)
    })

    it('errors with the OperationOutcome details on a 400 response', async () => {
        const { fetchImpl } = stubFetch(() =>
            jsonResponse(
                {
                    resourceType: 'OperationOutcome',
                    issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Missing context.encounter' }],
                },
                { status: 400 },
            ),
        )
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        const failure = outcome.validations.find(
            (v) => v.severity === 'ERROR' && v.message.includes('failed to upsert'),
        )
        expect(failure?.message).toContain('400')
        expect(failure?.message).toContain('Missing context.encounter')
    })

    it('errors on a 500 with no OperationOutcome', async () => {
        const { fetchImpl } = stubFetch(() => new Response('Internal Server Error', { status: 500 }))
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        const failure = outcome.validations.find(
            (v) => v.severity === 'ERROR' && v.message.includes('failed to upsert'),
        )
        expect(failure?.message).toContain('500')
        expect(failure?.message).toContain('No OperationOutcome was returned')
    })

    it('reports a transport failure (status 0) as an error', async () => {
        const fetchImpl = (async () => {
            throw new Error('getaddrinfo ENOTFOUND ehr.example.com')
        }) as unknown as typeof fetch
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        const failure = outcome.validations.find(
            (v) => v.severity === 'ERROR' && v.message.includes('failed to upsert'),
        )
        expect(failure?.message).toContain('transport failure')
    })

    it('handles a non-JSON response body without throwing', async () => {
        const { fetchImpl } = stubFetch(() => new Response('<html>error</html>', { status: 502 }))
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
    })

    it('errors when the server drops context.encounter on read-back', async () => {
        const { fetchImpl } = createFakeFhirServer({
            onRead: (resource) => ({ ...resource, context: {} }),
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'ERROR' && v.message.includes('context.encounter is missing'),
            ),
        ).toBe(true)
    })
})

describe('documentReferenceBinaryWriteProbe', () => {
    it('POSTs Binary then PUTs DocumentReference (twice, same id) with content.attachment.url referencing it', async () => {
        const { fetchImpl, calls } = createFakeFhirServer()
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceBinaryWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])

        const binaryPost = calls.find((c) => c.method === 'POST' && c.url === `${BASE_URL}/Binary`)
        expect(binaryPost).toBeDefined()

        const putCalls = calls.filter((c) => c.method === 'PUT' && c.url.includes('/DocumentReference/'))
        expect(putCalls).toHaveLength(2)
        expect(putCalls[0]?.url).toBe(putCalls[1]?.url)

        const sentBody = putCalls[0]?.body as { content: { attachment: { url?: string } }[] }
        expect(sentBody.content[0]?.attachment.url).toBe('Binary/server-assigned-1')
    })

    it('errors when the Binary POST fails, without attempting to write the DocumentReference', async () => {
        const { fetchImpl, calls } = stubFetch((call) => {
            if (call.url === `${BASE_URL}/Binary`) {
                return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 404 })
            }
            return jsonResponse({}, { status: 200 })
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceBinaryWriteProbe.run(context)

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
        expect(calls).toHaveLength(1)
        expect(calls[0]?.method).toBe('POST')
    })

    it('treats a 403 as correct behaviour on the DocumentReference PUT when no write scope was granted', async () => {
        const { fetchImpl, calls } = stubFetch(() =>
            jsonResponse({ resourceType: 'OperationOutcome' }, { status: 403 }),
        )
        const context = buildContext(fetchImpl, { grantedScopes: [] })

        const outcome = await documentReferenceBinaryWriteProbe.run(context)

        expect(calls).toHaveLength(1)
        expect(calls[0]?.method).toBe('PUT')
        expect(outcome.validations.some((v) => v.message.includes('correctly rejected'))).toBe(true)
    })
})

describe('binaryWriteProbe', () => {
    it('POSTs Binary via FHIR-JSON and via raw-body, and reads both back', async () => {
        const { fetchImpl, calls } = createFakeFhirServer()
        const context = buildContext(fetchImpl)

        const outcome = await binaryWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])

        const postCalls = calls.filter((c) => c.method === 'POST' && c.url === `${BASE_URL}/Binary`)
        expect(postCalls).toHaveLength(2)

        const jsonCall = postCalls.find((c) => c.headers['Content-Type'] === 'application/fhir+json')
        expect(jsonCall).toBeDefined()
        const jsonBody = jsonCall?.body as { resourceType: string; contentType: string }
        expect(jsonBody.resourceType).toBe('Binary')
        expect(jsonBody.contentType).toBe('application/pdf')

        const rawCall = postCalls.find((c) => c.headers['Content-Type'] === 'application/pdf')
        expect(rawCall).toBeDefined()
        expect(typeof rawCall?.body).not.toBe('string')

        expect(outcome.validations.some((v) => v.message.includes('Both Binary upload mechanisms'))).toBe(
            true,
        )
    })

    it('warns when only one Binary upload mechanism succeeds', async () => {
        const { fetchImpl } = stubFetch((call) => {
            if (call.headers['Content-Type'] === 'application/pdf') {
                return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 415 })
            }
            if (call.method === 'POST') {
                return jsonResponse(
                    {
                        resourceType: 'Binary',
                        id: 'json-binary',
                        contentType: 'application/pdf',
                        data: 'abc',
                    },
                    { status: 201, headers: { Location: `${BASE_URL}/Binary/json-binary` } },
                )
            }
            return jsonResponse({
                resourceType: 'Binary',
                id: 'json-binary',
                contentType: 'application/pdf',
                data: 'abc',
            })
        })
        const context = buildContext(fetchImpl)

        const outcome = await binaryWriteProbe.run(context)

        const warning = outcome.validations.find(
            (v) => v.severity === 'WARNING' && v.message.includes('Only the FHIR-JSON POST'),
        )
        expect(warning).toBeDefined()
    })

    it('errors when both Binary upload mechanisms fail', async () => {
        const { fetchImpl } = stubFetch(() =>
            jsonResponse({ resourceType: 'OperationOutcome' }, { status: 500 }),
        )
        const context = buildContext(fetchImpl)

        const outcome = await binaryWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'ERROR' && v.message.includes('Both Binary upload mechanisms'),
            ),
        ).toBe(true)
    })

    it('warns when a 201 create response omits the Location header', async () => {
        const { fetchImpl } = stubFetch((call) => {
            if (call.method === 'POST') {
                return jsonResponse(
                    { resourceType: 'Binary', id: 'x', contentType: 'application/pdf', data: 'a' },
                    { status: 201 },
                )
            }
            return jsonResponse({
                resourceType: 'Binary',
                id: 'x',
                contentType: 'application/pdf',
                data: 'a',
            })
        })
        const context = buildContext(fetchImpl)

        const outcome = await binaryWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'WARNING' && v.message.includes('did not include a Location'),
            ),
        ).toBe(true)
    })

    it('treats a 403 as correct when no Binary write scope was granted', async () => {
        const { fetchImpl } = stubFetch(() =>
            jsonResponse({ resourceType: 'OperationOutcome' }, { status: 403 }),
        )
        const context = buildContext(fetchImpl, { grantedScopes: ['patient/DocumentReference.write'] })

        const outcome = await binaryWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])
        expect(outcome.validations.some((v) => v.message.includes('correctly rejected'))).toBe(true)
    })

    it('errors on 401 Unauthorized', async () => {
        const { fetchImpl } = stubFetch(() =>
            jsonResponse({ resourceType: 'OperationOutcome' }, { status: 401 }),
        )
        const context = buildContext(fetchImpl)

        const outcome = await binaryWriteProbe.run(context)

        expect(outcome.validations.some((v) => v.severity === 'ERROR' && v.message.includes('401'))).toBe(
            true,
        )
    })
})

describe('questionnaireResponseWriteProbe', () => {
    it('PUTs to [base]/QuestionnaireResponse/{client-assigned-id} twice and is searchable by subject and encounter', async () => {
        const { fetchImpl, calls } = createFakeFhirServer()
        const context = buildContext(fetchImpl)

        const outcome = await questionnaireResponseWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])

        const putCalls = calls.filter((c) => c.method === 'PUT')
        expect(putCalls).toHaveLength(2)
        expect(putCalls[0]?.url).toMatch(/\/QuestionnaireResponse\/smart-on-fhir-validator-qr-/)
        expect(putCalls[0]?.url).toBe(putCalls[1]?.url)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'OK' && v.message.includes('did not produce a different resource id'),
            ),
        ).toBe(true)
    })

    it('warns with OperationOutcome details on a 422 response, since QuestionnaireResponse write support is optional per ADR01', async () => {
        const { fetchImpl } = stubFetch(() =>
            jsonResponse(
                {
                    resourceType: 'OperationOutcome',
                    issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Unknown linkId' }],
                },
                { status: 422 },
            ),
        )
        const context = buildContext(fetchImpl)

        const outcome = await questionnaireResponseWriteProbe.run(context)

        const failure = outcome.validations.find(
            (v) => v.severity === 'WARNING' && v.message.includes('failed to upsert'),
        )
        expect(failure?.message).toContain('422')
        expect(failure?.message).toContain('Unknown linkId')
        expect(failure?.message).toContain('optional per ADR01')
    })

    it('skips when launch context is missing an encounter', async () => {
        const { fetchImpl } = stubFetch(() => jsonResponse({}))
        const context = buildContext(fetchImpl, { encounterId: null })

        const outcome = await questionnaireResponseWriteProbe.run(context)

        expect(outcome.skipped).toBeDefined()
    })
})

describe('bundleBatchWriteProbe', () => {
    it('submits a batch Bundle with PUT entries and validates a batch-response', async () => {
        const { fetchImpl, calls } = stubFetch((call) => {
            expect(call.url).toBe(`${BASE_URL}`)
            const sent = call.body as { entry: { request: { method: string; url: string } }[] }
            return jsonResponse({
                resourceType: 'Bundle',
                type: 'batch-response',
                entry: sent.entry.map(() => ({ response: { status: '200 OK' } })),
            })
        })
        const context = buildContext(fetchImpl)

        const outcome = await bundleBatchWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])
        expect(calls).toHaveLength(1)
        const sentBundle = calls[0]?.body as {
            type: string
            entry: { request: { method: string; url: string }; resource: { resourceType: string } }[]
        }
        expect(sentBundle.type).toBe('batch')
        expect(sentBundle.entry.every((entry) => entry.request.method === 'PUT')).toBe(true)
        expect(sentBundle.entry.map((entry) => entry.resource.resourceType).toSorted()).toEqual([
            'DocumentReference',
            'QuestionnaireResponse',
        ])
    })

    it('surfaces a partial failure without failing the whole batch', async () => {
        const { fetchImpl } = stubFetch(() =>
            jsonResponse({
                resourceType: 'Bundle',
                type: 'batch-response',
                entry: [
                    {
                        response: {
                            status: '422 Unprocessable Entity',
                            outcome: {
                                resourceType: 'OperationOutcome',
                                issue: [
                                    {
                                        severity: 'error',
                                        code: 'invalid',
                                        diagnostics: 'Bad QuestionnaireResponse',
                                    },
                                ],
                            },
                        },
                    },
                    { response: { status: '201 Created' } },
                ],
            }),
        )
        const context = buildContext(fetchImpl)

        const outcome = await bundleBatchWriteProbe.run(context)

        const failure = outcome.validations.find((v) => v.message.includes('Bad QuestionnaireResponse'))
        expect(failure?.severity).toBe('WARNING')
        const success = outcome.validations.find((v) =>
            v.message.includes('succeeded with status "201 Created"'),
        )
        expect(success?.severity).toBe('OK')
    })

    it('skips cleanly when the QuestionnaireResponse write scope is missing', async () => {
        const { fetchImpl, calls } = stubFetch(() => jsonResponse({}))
        const context = buildContext(fetchImpl, { grantedScopes: ['patient/DocumentReference.write'] })

        const outcome = await bundleBatchWriteProbe.run(context)

        expect(outcome.skipped).toBeDefined()
        expect(outcome.skipped?.reason).toContain('QuestionnaireResponse')
        expect(calls).toHaveLength(0)
    })
})
