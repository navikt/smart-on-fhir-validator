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

/** Builds an injectable `fetch` stub that dispatches on method+URL and records every call made. */
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

    it('POSTs to [base]/DocumentReference with context.encounter set, then reads back and searches by subject and encounter', async () => {
        const created = {
            resourceType: 'DocumentReference',
            id: 'server-assigned-1',
            status: 'current',
            type: {
                coding: [
                    {
                        system: 'urn:oid:2.16.578.1.12.4.1.1.9602',
                        code: 'J01-2',
                        display: 'Sykmeldinger og trygdesaker',
                    },
                ],
            },
            subject: { reference: 'Patient/patient-1' },
            author: [{ reference: 'Practitioner/practitioner-1' }],
            date: '2026-01-01T00:00:00Z',
            description: 'Sykmelding',
            content: [
                {
                    attachment: {
                        title: 'Sykmelding',
                        language: 'NO-nb',
                        contentType: 'application/pdf',
                        data: 'abc',
                    },
                },
            ],
            context: { encounter: [{ reference: 'Encounter/encounter-1' }] },
        }

        const { fetchImpl, calls } = stubFetch((call) => {
            if (call.method === 'POST' && call.url === `${BASE_URL}/DocumentReference`) {
                return jsonResponse(created, {
                    status: 201,
                    headers: { Location: `${BASE_URL}/DocumentReference/server-assigned-1` },
                })
            }
            if (call.method === 'GET' && call.url === `${BASE_URL}/DocumentReference/server-assigned-1`) {
                return jsonResponse(created)
            }
            if (call.method === 'GET' && call.url.startsWith(`${BASE_URL}/DocumentReference?subject=`)) {
                return jsonResponse({
                    resourceType: 'Bundle',
                    type: 'searchset',
                    entry: [{ resource: created }],
                })
            }
            if (call.method === 'GET' && call.url.startsWith(`${BASE_URL}/DocumentReference?encounter=`)) {
                return jsonResponse({
                    resourceType: 'Bundle',
                    type: 'searchset',
                    entry: [{ resource: created }],
                })
            }
            return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 404 })
        })

        const context = buildContext(fetchImpl)
        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])
        expect(outcome.skipped).toBeUndefined()

        const createCall = calls.find((c) => c.method === 'POST')
        expect(createCall?.url).toBe(`${BASE_URL}/DocumentReference`)
        expect(createCall?.headers['Content-Type']).toBe('application/fhir+json')
        expect(createCall?.headers['Authorization']).toBe('Bearer token-abc')
        const sentBody = createCall?.body as {
            context?: { encounter?: { reference: string }[] }
            subject?: { reference: string }
        }
        expect(sentBody.context?.encounter?.[0]?.reference).toBe('Encounter/encounter-1')
        expect(sentBody.subject?.reference).toBe('Patient/patient-1')

        const subjectSearch = calls.find((c) => c.url.includes('subject='))
        expect(subjectSearch?.url).toBe(`${BASE_URL}/DocumentReference?subject=Patient%2Fpatient-1`)

        const encounterSearch = calls.find((c) => c.url.includes('encounter='))
        expect(encounterSearch?.url).toBe(`${BASE_URL}/DocumentReference?encounter=Encounter%2Fencounter-1`)
    })

    it('treats a 403 as correct behaviour when no write scope was granted', async () => {
        const { fetchImpl, calls } = stubFetch(() =>
            jsonResponse({ resourceType: 'OperationOutcome' }, { status: 403 }),
        )
        const context = buildContext(fetchImpl, { grantedScopes: [] })

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(calls).toHaveLength(1)
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

    it('warns when the server returns 200 instead of 201', async () => {
        const { fetchImpl } = stubFetch((call) => {
            if (call.method === 'POST') {
                return jsonResponse({ resourceType: 'DocumentReference', id: 'x' }, { status: 200 })
            }
            return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 404 })
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'WARNING' && v.message.includes('200 OK instead of 201'),
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
            (v) => v.severity === 'ERROR' && v.message.includes('failed to create'),
        )
        expect(failure?.message).toContain('400')
        expect(failure?.message).toContain('Missing context.encounter')
    })

    it('errors on a 500 with no OperationOutcome', async () => {
        const { fetchImpl } = stubFetch(() => new Response('Internal Server Error', { status: 500 }))
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        const failure = outcome.validations.find(
            (v) => v.severity === 'ERROR' && v.message.includes('failed to create'),
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
            (v) => v.severity === 'ERROR' && v.message.includes('failed to create'),
        )
        expect(failure?.message).toContain('transport failure')
    })

    it('handles a non-JSON response body without throwing', async () => {
        const { fetchImpl } = stubFetch(() => new Response('<html>error</html>', { status: 502 }))
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
    })

    it('errors when a 201 response omits the Location header', async () => {
        const created = { resourceType: 'DocumentReference', id: 'x' }
        const { fetchImpl } = stubFetch((call) => {
            if (call.method === 'POST') return jsonResponse(created, { status: 201 })
            return jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [] })
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceInlineWriteProbe.run(context)

        expect(
            outcome.validations.some(
                (v) => v.severity === 'WARNING' && v.message.includes('did not include a Location'),
            ),
        ).toBe(true)
    })

    it('errors when the server drops context.encounter on read-back', async () => {
        const created = {
            resourceType: 'DocumentReference',
            id: 'x',
            status: 'current',
            type: { coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.9602', code: 'J01-2' }] },
            subject: { reference: 'Patient/patient-1' },
            author: [{ reference: 'Practitioner/practitioner-1' }],
            content: [{ attachment: { contentType: 'application/pdf', data: 'abc' } }],
            context: { encounter: [{ reference: 'Encounter/encounter-1' }] },
        }
        const droppedOnReadBack = { ...created, context: {} }

        const { fetchImpl } = stubFetch((call) => {
            if (call.method === 'POST') {
                return jsonResponse(created, {
                    status: 201,
                    headers: { Location: `${BASE_URL}/DocumentReference/x` },
                })
            }
            if (call.method === 'GET' && call.url.endsWith('/DocumentReference/x')) {
                return jsonResponse(droppedOnReadBack)
            }
            return jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [] })
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
    it('POSTs Binary then DocumentReference with content.attachment.url referencing it', async () => {
        const binary = { resourceType: 'Binary', id: 'binary-1', contentType: 'application/pdf', data: 'abc' }
        const doc = {
            resourceType: 'DocumentReference',
            id: 'doc-1',
            status: 'current',
            type: {
                coding: [
                    {
                        system: 'urn:oid:2.16.578.1.12.4.1.1.9602',
                        code: 'J01-2',
                        display: 'Sykmeldinger og trygdesaker',
                    },
                ],
            },
            subject: { reference: 'Patient/patient-1' },
            author: [{ reference: 'Practitioner/practitioner-1' }],
            date: '2026-01-01T00:00:00Z',
            description: 'Sykmelding',
            content: [
                {
                    attachment: {
                        title: 'Sykmelding',
                        language: 'NO-nb',
                        contentType: 'application/pdf',
                        url: 'Binary/binary-1',
                    },
                },
            ],
            context: { encounter: [{ reference: 'Encounter/encounter-1' }] },
        }

        const { fetchImpl, calls } = stubFetch((call) => {
            if (call.method === 'POST' && call.url === `${BASE_URL}/Binary`) {
                return jsonResponse(binary, {
                    status: 201,
                    headers: { Location: `${BASE_URL}/Binary/binary-1` },
                })
            }
            if (call.method === 'POST' && call.url === `${BASE_URL}/DocumentReference`) {
                return jsonResponse(doc, {
                    status: 201,
                    headers: { Location: `${BASE_URL}/DocumentReference/doc-1` },
                })
            }
            if (call.method === 'GET' && call.url.endsWith('/DocumentReference/doc-1')) {
                return jsonResponse(doc)
            }
            return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 404 })
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceBinaryWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])
        const docCall = calls.find((c) => c.method === 'POST' && c.url === `${BASE_URL}/DocumentReference`)
        const sentBody = docCall?.body as { content: { attachment: { url?: string } }[] }
        expect(sentBody.content[0]?.attachment.url).toBe('Binary/binary-1')
    })

    it('errors when the Binary POST fails, without attempting to create the DocumentReference', async () => {
        const { fetchImpl, calls } = stubFetch((call) => {
            if (call.url === `${BASE_URL}/Binary`) {
                return jsonResponse({ resourceType: 'OperationOutcome' }, { status: 404 })
            }
            return jsonResponse({}, { status: 200 })
        })
        const context = buildContext(fetchImpl)

        const outcome = await documentReferenceBinaryWriteProbe.run(context)

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
        expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
})

describe('binaryWriteProbe', () => {
    it('POSTs Binary as FHIR-JSON with contentType and base64 data, then reads it back', async () => {
        const binary = { resourceType: 'Binary', id: 'binary-1', contentType: 'application/pdf', data: 'abc' }
        const { fetchImpl, calls } = stubFetch((call) => {
            if (call.method === 'POST') {
                return jsonResponse(binary, {
                    status: 201,
                    headers: { Location: `${BASE_URL}/Binary/binary-1` },
                })
            }
            return jsonResponse(binary)
        })
        const context = buildContext(fetchImpl)

        const outcome = await binaryWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])
        const createCall = calls.find((c) => c.method === 'POST')
        expect(createCall?.url).toBe(`${BASE_URL}/Binary`)
        expect(createCall?.headers['Content-Type']).toBe('application/fhir+json')
        const body = createCall?.body as { resourceType: string; contentType: string; data: string }
        expect(body.resourceType).toBe('Binary')
        expect(body.contentType).toBe('application/pdf')
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
    it('POSTs to [base]/QuestionnaireResponse and is searchable by subject and encounter', async () => {
        const created = {
            resourceType: 'QuestionnaireResponse',
            id: 'qr-1',
            questionnaire: 'https://www.nav.no/samarbeidspartner/sykmelding/fhir/R4/Questionnaire/V1',
            status: 'completed',
            subject: { reference: 'Patient/patient-1' },
            encounter: { reference: 'Encounter/encounter-1' },
            authored: '2026-01-01T00:00:00Z',
            author: { reference: 'Practitioner/practitioner-1' },
            item: [{ linkId: 'hoveddiagnose', answer: [{ valueCoding: { code: 'Z09' } }] }],
        }
        const { fetchImpl, calls } = stubFetch((call) => {
            if (call.method === 'POST') {
                return jsonResponse(created, {
                    status: 201,
                    headers: { Location: `${BASE_URL}/QuestionnaireResponse/qr-1` },
                })
            }
            return jsonResponse({ resourceType: 'Bundle', type: 'searchset', entry: [{ resource: created }] })
        })
        const context = buildContext(fetchImpl)

        const outcome = await questionnaireResponseWriteProbe.run(context)

        expect(bad(outcome.validations)).toEqual([])
        const createCall = calls.find((c) => c.method === 'POST')
        expect(createCall?.url).toBe(`${BASE_URL}/QuestionnaireResponse`)
    })

    it('errors with OperationOutcome details on a 422 response', async () => {
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
            (v) => v.severity === 'ERROR' && v.message.includes('failed to create'),
        )
        expect(failure?.message).toContain('422')
        expect(failure?.message).toContain('Unknown linkId')
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
