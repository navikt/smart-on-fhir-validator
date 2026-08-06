import type { Condition } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient, buildSearchUrl } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'

import { conditionProbe, validateConditionResource } from './condition'

const BASE_URL = 'https://ehr.example.com/fhir'

function launchContext(overrides: Partial<LaunchContext> = {}): LaunchContext {
    return {
        patientId: 'patient-123',
        encounterId: 'encounter-1',
        fhirUser: null,
        practitionerId: null,
        grantedScopes: ['patient/Condition.rs'],
        ...overrides,
    }
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
    return (async (input: RequestInfo | URL) => handler(input.toString())) as typeof fetch
}

function fhirClientFor(handler: (url: string) => Response | Promise<Response>): FhirClient {
    const recorder = createExchangeRecorder()
    const http = new SmartHttpClient({ recorder, fetchImpl: stubFetch(handler) })
    return new FhirClient({ http, baseUrl: BASE_URL, accessToken: 'token' })
}

function fhirJson(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/fhir+json' },
    })
}

function searchBundle(entries: Condition[]) {
    return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: entries.length,
        entry: entries.map((resource) => ({ resource, search: { mode: 'match' } })),
    }
}

const validCondition: Condition = {
    resourceType: 'Condition',
    id: 'condition-1',
    subject: { reference: 'Patient/patient-123' },
    encounter: { reference: 'Encounter/encounter-1' },
    code: {
        coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.7170', code: 'L73', display: 'Brudd legg/ankel' }],
    },
}

describe('validateConditionResource', () => {
    it('has no violations for a conformant ICPC-2 Condition', () => {
        const violations = validateConditionResource([validCondition]).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('has no violations for a conformant ICD-10 Condition', () => {
        const condition: Condition = {
            ...validCondition,
            code: {
                coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.7110', code: 'S82', display: 'Fracture' }],
            },
        }
        const violations = validateConditionResource([condition]).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('errors when subject is missing', () => {
        const { subject: _subject, ...rest } = validCondition
        const violations = validateConditionResource([rest as Condition])
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('subject'))).toBe(true)
    })

    it('errors when no coding entries are present', () => {
        const condition: Condition = { ...validCondition, code: {} }
        const violations = validateConditionResource([condition])
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('coding'))).toBe(true)
    })

    it('errors when the coding system is not ICD-10/ICPC-2/ICPC-2B', () => {
        const condition: Condition = {
            ...validCondition,
            code: { coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.9999', code: 'X' }] },
        }
        const violations = validateConditionResource([condition])
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('unrecognised'))).toBe(
            true,
        )
    })

    it('errors when a valid coding has no code', () => {
        const condition: Condition = {
            ...validCondition,
            code: { coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.7170', display: 'Something' }] },
        }
        const violations = validateConditionResource([condition])
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('no `code`'))).toBe(true)
    })

    it('warns (not errors) when a valid coding has no display', () => {
        const condition: Condition = {
            ...validCondition,
            code: { coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.7170', code: 'L73' }] },
        }
        const violations = validateConditionResource([condition])
        expect(violations.some((v) => v.severity === 'WARNING' && v.message.includes('display'))).toBe(true)
        expect(violations.some((v) => v.severity === 'ERROR')).toBe(false)
    })
})

describe('conditionProbe', () => {
    it('is skipped when launch context has no patient id', async () => {
        const fhir = fhirClientFor(() => fhirJson(searchBundle([validCondition])))
        const outcome = await conditionProbe.run({ fhir, launch: launchContext({ patientId: null }) })

        expect(outcome.skipped).toBeDefined()
    })

    it('is marked as not required, since Condition is optional for Nav', () => {
        expect(conditionProbe.required).toBe(false)
    })

    it('searches subject=Patient/{id} built from launch context', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            return fhirJson(searchBundle([validCondition]))
        })

        await conditionProbe.run({ fhir, launch: launchContext() })

        const expectedUrl = buildSearchUrl(BASE_URL, 'Condition', { subject: 'Patient/patient-123' })
        expect(requestedUrls).toContain(expectedUrl)
    })

    it('also searches encounter=Encounter/{id} when an encounter is in context', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            return fhirJson(searchBundle([validCondition]))
        })

        await conditionProbe.run({ fhir, launch: launchContext() })

        const expectedUrl = buildSearchUrl(BASE_URL, 'Condition', { encounter: 'Encounter/encounter-1' })
        expect(requestedUrls).toContain(expectedUrl)
    })

    it('does not search by encounter when launch context has no encounter id', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            return fhirJson(searchBundle([validCondition]))
        })

        await conditionProbe.run({ fhir, launch: launchContext({ encounterId: null }) })

        expect(requestedUrls.some((url) => url.includes('encounter='))).toBe(false)
    })

    it('reports INFO, not ERROR or WARNING, for an empty searchset', async () => {
        const fhir = fhirClientFor(() => fhirJson(searchBundle([])))
        const outcome = await conditionProbe.run({ fhir, launch: launchContext() })

        expect(
            outcome.validations.some(
                (v) => v.severity === 'INFO' && v.message.includes('matched no Condition'),
            ),
        ).toBe(true)
        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(false)
        expect(outcome.validations.some((v) => v.severity === 'WARNING')).toBe(false)
    })

    it('caps the encounter= search failure severity at WARNING', async () => {
        const fhir = fhirClientFor((url) => {
            if (url.includes('encounter=')) {
                return new Response(
                    JSON.stringify({
                        resourceType: 'OperationOutcome',
                        issue: [
                            {
                                severity: 'error',
                                code: 'not-supported',
                                diagnostics: 'Condition does not support the search parameter(s): encounter',
                            },
                        ],
                    }),
                    { status: 400, headers: { 'Content-Type': 'application/fhir+json' } },
                )
            }
            return fhirJson(searchBundle([validCondition]))
        })

        const outcome = await conditionProbe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.message.includes('encounter=` search'))).toBe(true)
        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(false)
    })
})
