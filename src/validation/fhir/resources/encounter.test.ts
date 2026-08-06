import type { Encounter } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient, buildSearchUrl } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'

import { encounterProbe, validateEncounterResource } from './encounter'

const BASE_URL = 'https://ehr.example.com/fhir'

function launchContext(overrides: Partial<LaunchContext> = {}): LaunchContext {
    return {
        patientId: 'patient-123',
        encounterId: 'encounter-1',
        fhirUser: null,
        practitionerId: null,
        grantedScopes: ['patient/Encounter.rs'],
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

function searchBundle(entries: Encounter[]) {
    return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: entries.length,
        entry: entries.map((resource) => ({ resource, search: { mode: 'match' } })),
    }
}

const validEncounter: Encounter = {
    resourceType: 'Encounter',
    id: 'encounter-1',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    subject: { reference: 'Patient/patient-123' },
    participant: [{ individual: { reference: 'Practitioner/practitioner-456' } }],
    serviceProvider: { reference: 'Organization/org-1' },
    diagnosis: [{ condition: { reference: 'Condition/condition-1' } }],
}

describe('validateEncounterResource', () => {
    it('has no violations for a conformant Encounter', () => {
        const violations = validateEncounterResource(validEncounter).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('errors when subject is missing', () => {
        const encounter: Encounter = { ...validEncounter, subject: undefined }
        const violations = validateEncounterResource(encounter)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('subject'))).toBe(true)
    })

    it('errors when no participant is present', () => {
        const encounter: Encounter = { ...validEncounter, participant: [] }
        const violations = validateEncounterResource(encounter)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('participant'))).toBe(true)
    })

    it('errors when serviceProvider is missing', () => {
        const encounter: Encounter = { ...validEncounter, serviceProvider: undefined }
        const violations = validateEncounterResource(encounter)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('serviceProvider'))).toBe(
            true,
        )
    })

    it('warns (not errors) when diagnosis is missing, since it is optional', () => {
        const encounter: Encounter = { ...validEncounter, diagnosis: undefined }
        const violations = validateEncounterResource(encounter)
        expect(violations.some((v) => v.severity === 'WARNING' && v.message.includes('diagnosis'))).toBe(true)
        expect(violations.some((v) => v.severity === 'ERROR')).toBe(false)
    })

    it('errors when a diagnosis condition reference does not start with Condition/', () => {
        const encounter: Encounter = {
            ...validEncounter,
            diagnosis: [{ condition: { reference: 'condition-1' } }],
        }
        const violations = validateEncounterResource(encounter)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('Condition/'))).toBe(true)
    })

    it('warns (not errors) when class is missing', () => {
        const { class: _class, ...rest } = validEncounter
        const violations = validateEncounterResource(rest as Encounter)
        expect(violations.some((v) => v.severity === 'WARNING' && v.message.includes('class'))).toBe(true)
        expect(violations.some((v) => v.severity === 'ERROR')).toBe(false)
    })
})

describe('encounterProbe', () => {
    it('is skipped when launch context has neither patient nor encounter id', async () => {
        const fhir = fhirClientFor(() => fhirJson(validEncounter))
        const outcome = await encounterProbe.run({
            fhir,
            launch: launchContext({ patientId: null, encounterId: null }),
        })

        expect(outcome.skipped).toBeDefined()
    })

    it('reads Encounter/{id} from launch context', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            if (url.includes('?')) return fhirJson(searchBundle([validEncounter]))
            return fhirJson(validEncounter)
        })

        await encounterProbe.run({ fhir, launch: launchContext() })

        expect(requestedUrls).toContain(`${BASE_URL}/Encounter/encounter-1`)
    })

    it('searches subject=Patient/{id}, the primary FHIR R4-defined parameter', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            if (url.includes('?')) return fhirJson(searchBundle([validEncounter]))
            return fhirJson(validEncounter)
        })

        await encounterProbe.run({ fhir, launch: launchContext() })

        const expectedSubjectUrl = buildSearchUrl(BASE_URL, 'Encounter', { subject: 'Patient/patient-123' })
        expect(requestedUrls).toContain(expectedSubjectUrl)
    })

    it('also exercises patient=Patient/{id} and caps its failure severity at WARNING', async () => {
        const fhir = fhirClientFor((url) => {
            if (url.includes('patient=')) {
                return new Response(
                    JSON.stringify({
                        resourceType: 'OperationOutcome',
                        issue: [
                            {
                                severity: 'error',
                                code: 'not-supported',
                                diagnostics: 'Encounter does not support the search parameter(s): patient',
                            },
                        ],
                    }),
                    { status: 400, headers: { 'Content-Type': 'application/fhir+json' } },
                )
            }
            if (url.includes('subject=')) return fhirJson(searchBundle([validEncounter]))
            return fhirJson(validEncounter)
        })

        const outcome = await encounterProbe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.message.includes('patient=` search'))).toBe(true)
        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(false)
    })

    it('validates the resource obtained from the id read when both id and searches are available', async () => {
        const fhir = fhirClientFor((url) => {
            if (url.includes('?')) return fhirJson(searchBundle([]))
            return fhirJson({ ...validEncounter, participant: [] })
        })

        const outcome = await encounterProbe.run({ fhir, launch: launchContext() })

        expect(
            outcome.validations.some((v) => v.severity === 'ERROR' && v.message.includes('participant')),
        ).toBe(true)
    })

    it('runs only the search when launch context has no encounterId', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            return fhirJson(searchBundle([validEncounter]))
        })

        await encounterProbe.run({ fhir, launch: launchContext({ encounterId: null }) })

        expect(requestedUrls.every((url) => url.includes('?'))).toBe(true)
    })
})
