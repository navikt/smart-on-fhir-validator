import type { Patient } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient, buildSearchUrl } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'

import { patientProbe, validatePatientResource } from './patient'

const BASE_URL = 'https://ehr.example.com/fhir'

function launchContext(overrides: Partial<LaunchContext> = {}): LaunchContext {
    return {
        patientId: 'patient-123',
        encounterId: null,
        fhirUser: null,
        practitionerId: null,
        grantedScopes: ['patient/Patient.rs'],
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

const validPatient: Patient = {
    resourceType: 'Patient',
    id: 'patient-123',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Patient'] },
    identifier: [{ system: 'urn:oid:2.16.578.1.12.4.1.4.1', value: '01019012345' }],
    name: [{ family: 'Eksempel', given: ['Espen'] }],
}

describe('validatePatientResource', () => {
    it('has no violations for a conformant no-basis-Patient', () => {
        const violations = validatePatientResource(validPatient).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('errors when meta.profile is missing no-basis-Patient', () => {
        const { meta: _meta, ...rest } = validPatient
        const violations = validatePatientResource(rest as Patient)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('no-basis-Patient'))).toBe(
            true,
        )
    })

    it('errors when neither FNR nor D-number identifier is present', () => {
        const patient: Patient = { ...validPatient, identifier: [] }
        const violations = validatePatientResource(patient)
        expect(
            violations.some((v) => v.severity === 'ERROR' && v.message.includes('2.16.578.1.12.4.1.4.1')),
        ).toBe(true)
    })

    it('accepts a D-number as an alternative to FNR', () => {
        const patient: Patient = {
            ...validPatient,
            identifier: [{ system: 'urn:oid:2.16.578.1.12.4.1.4.2', value: '41019012345' }],
        }
        const violations = validatePatientResource(patient).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('errors when name is missing entirely', () => {
        const patient: Patient = { ...validPatient, name: [] }
        const violations = validatePatientResource(patient)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('name'))).toBe(true)
    })

    it('errors when family name is missing', () => {
        const patient: Patient = { ...validPatient, name: [{ given: ['Espen'] }] }
        const violations = validatePatientResource(patient)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('family'))).toBe(true)
    })

    it('errors when given name is missing', () => {
        const patient: Patient = { ...validPatient, name: [{ family: 'Eksempel' }] }
        const violations = validatePatientResource(patient)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('given'))).toBe(true)
    })
})

describe('patientProbe', () => {
    it('is skipped when launch context has no patient id', async () => {
        const fhir = fhirClientFor(() => fhirJson(validPatient))
        const outcome = await patientProbe.run({ fhir, launch: launchContext({ patientId: null }) })

        expect(outcome.skipped).toBeDefined()
        expect(outcome.validations).toEqual([])
    })

    it('reads Patient/{id} and validates the resource', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            if (url.includes('/Patient/patient-123') && !url.includes('?')) return fhirJson(validPatient)
            return fhirJson({
                resourceType: 'Bundle',
                type: 'searchset',
                total: 1,
                entry: [{ resource: validPatient, search: { mode: 'match' } }],
            })
        })

        const outcome = await patientProbe.run({ fhir, launch: launchContext() })

        expect(requestedUrls[0]).toBe(`${BASE_URL}/Patient/patient-123`)
        expect(outcome.validations.every((v) => v.severity !== 'ERROR')).toBe(true)
        expect(outcome.exchangeId).toBeTruthy()
    })

    it('issues the supplementary search using _id built from launch context', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            if (url.includes('?')) {
                return fhirJson({
                    resourceType: 'Bundle',
                    type: 'searchset',
                    total: 1,
                    entry: [{ resource: validPatient, search: { mode: 'match' } }],
                })
            }
            return fhirJson(validPatient)
        })

        await patientProbe.run({ fhir, launch: launchContext() })

        const expectedSearchUrl = buildSearchUrl(BASE_URL, 'Patient', { _id: 'patient-123' })
        expect(requestedUrls).toContain(expectedSearchUrl)
    })

    it('caps the supplementary search failure severity at WARNING, never ERROR', async () => {
        const fhir = fhirClientFor((url) => {
            if (url.includes('?')) {
                return new Response(
                    JSON.stringify({
                        resourceType: 'OperationOutcome',
                        issue: [
                            { severity: 'error', code: 'not-supported', diagnostics: '_id not supported' },
                        ],
                    }),
                    { status: 400, headers: { 'Content-Type': 'application/fhir+json' } },
                )
            }
            return fhirJson(validPatient)
        })

        const outcome = await patientProbe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(false)
        expect(outcome.validations.some((v) => v.message.includes('supplementary search'))).toBe(true)
    })

    it('reports an ERROR when the read itself fails, e.g. a 404', async () => {
        const fhir = fhirClientFor((url) => {
            if (url.includes('?')) {
                return fhirJson({ resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] })
            }
            return fhirJson(
                {
                    resourceType: 'OperationOutcome',
                    issue: [
                        {
                            severity: 'error',
                            code: 'not-found',
                            diagnostics: 'Patient/patient-123 does not exist',
                        },
                    ],
                },
                404,
            )
        })

        const outcome = await patientProbe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
    })
})
