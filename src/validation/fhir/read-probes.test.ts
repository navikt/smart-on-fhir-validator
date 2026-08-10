import type { Condition, Encounter, Organization, Patient, Practitioner, PractitionerRole } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'

import { createReadProbes, runReadProbes } from './read-probes'

const BASE_URL = 'https://ehr.example.com/fhir'

const patient: Patient = {
    resourceType: 'Patient',
    id: 'patient-123',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Patient'] },
    identifier: [{ system: 'urn:oid:2.16.578.1.12.4.1.4.1', value: '01019012345' }],
    name: [{ family: 'Eksempel', given: ['Espen'] }],
}

const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: 'practitioner-456',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner'] },
    identifier: [{ system: 'urn:oid:2.16.578.1.12.4.1.4.4', value: '9144889' }],
    name: [{ family: 'Jarvery', given: ['Sidsel'] }],
}

const practitionerRole: PractitionerRole = {
    resourceType: 'PractitionerRole',
    id: 'role-1',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-PractitionerRole'] },
    practitioner: { reference: 'Practitioner/practitioner-456' },
    organization: { reference: 'Organization/org-1' },
}

const organization: Organization = {
    resourceType: 'Organization',
    id: 'org-1',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Organization'] },
    identifier: [{ system: 'urn:oid:2.16.578.1.12.4.1.4.101', value: '987654325' }],
    telecom: [{ system: 'phone', value: '12345678' }],
}

const encounter: Encounter = {
    resourceType: 'Encounter',
    id: 'encounter-1',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    subject: { reference: 'Patient/patient-123' },
    participant: [{ individual: { reference: 'Practitioner/practitioner-456' } }],
    serviceProvider: { reference: 'Organization/org-1' },
    diagnosis: [{ condition: { reference: 'Condition/condition-1' } }],
}

const condition: Condition = {
    resourceType: 'Condition',
    id: 'condition-1',
    subject: { reference: 'Patient/patient-123' },
    encounter: { reference: 'Encounter/encounter-1' },
    code: {
        coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.7170', code: 'L73', display: 'Brudd legg/ankel' }],
    },
}

function fhirJson(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/fhir+json' },
    })
}

function searchBundle(entries: readonly { resourceType: string; id?: string }[]) {
    return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: entries.length,
        entry: entries.map((resource) => ({ resource, search: { mode: 'match' } })),
    }
}

function notFound(resourceType: string, id: string): Response {
    return fhirJson(
        {
            resourceType: 'OperationOutcome',
            issue: [
                { severity: 'error', code: 'not-found', diagnostics: `${resourceType}/${id} does not exist` },
            ],
        },
        404,
    )
}

function conformantFhirClient(requestedUrls: string[]): FhirClient {
    const recorder = createExchangeRecorder()
    const http = new SmartHttpClient({
        recorder,
        fetchImpl: (async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString()
            requestedUrls.push(url)
            const parsed = new URL(url)
            const path = parsed.pathname

            if (path === '/fhir/Patient/patient-123') return fhirJson(patient)
            if (path === '/fhir/Patient' && parsed.searchParams.get('_id') === 'patient-123') {
                return fhirJson(searchBundle([patient]))
            }
            if (path === '/fhir/Practitioner/practitioner-456') return fhirJson(practitioner)
            if (
                path === '/fhir/PractitionerRole' &&
                parsed.searchParams.get('practitioner') === 'Practitioner/practitioner-456'
            ) {
                return fhirJson(searchBundle([practitionerRole]))
            }
            if (path === '/fhir/Organization/org-1') return fhirJson(organization)
            if (path === '/fhir/Encounter/encounter-1') return fhirJson(encounter)
            if (path === '/fhir/Encounter' && parsed.searchParams.get('subject') === 'Patient/patient-123') {
                return fhirJson(searchBundle([encounter]))
            }
            if (path === '/fhir/Encounter' && parsed.searchParams.get('patient') === 'Patient/patient-123') {
                return fhirJson(searchBundle([encounter]))
            }
            if (path === '/fhir/Condition' && parsed.searchParams.get('subject') === 'Patient/patient-123') {
                return fhirJson(searchBundle([condition]))
            }
            if (
                path === '/fhir/Condition' &&
                parsed.searchParams.get('encounter') === 'Encounter/encounter-1'
            ) {
                return fhirJson(searchBundle([condition]))
            }

            return notFound('Unknown', 'unknown')
        }) as typeof fetch,
    })

    return new FhirClient({ http, baseUrl: BASE_URL, accessToken: 'token' })
}

function launchContext(overrides: Partial<LaunchContext> = {}): LaunchContext {
    return {
        patientId: 'patient-123',
        encounterId: 'encounter-1',
        fhirUser: 'Practitioner/practitioner-456',
        practitionerId: 'practitioner-456',
        grantedScopes: [
            'patient/Patient.rs',
            'patient/Practitioner.rs',
            'patient/PractitionerRole.rs',
            'patient/Organization.rs',
            'patient/Encounter.rs',
            'patient/Condition.rs',
        ],
        ...overrides,
    }
}

describe('createReadProbes', () => {
    it('orders probes as Patient, Practitioner, PractitionerRole, Organization, Encounter, Condition', () => {
        const ids = createReadProbes().map((probe) => probe.id)
        expect(ids).toEqual([
            'patient',
            'practitioner',
            'practitioner-role',
            'organization',
            'encounter',
            'condition',
        ])
    })

    it('builds a fresh discovery per call, so no state leaks between report runs', () => {
        const [, , firstRole] = createReadProbes()
        const [, , secondRole] = createReadProbes()
        expect(firstRole).not.toBe(secondRole)
    })
})

describe('runReadProbes', () => {
    it('reports no ERROR findings for a fully conformant EHR', async () => {
        const requestedUrls: string[] = []
        const fhir = conformantFhirClient(requestedUrls)

        const outcomes = await runReadProbes({ fhir, launch: launchContext() })

        for (const outcome of outcomes) {
            const errors = outcome.validations.filter((v) => v.severity === 'ERROR')
            expect(errors, `${outcome.label} had unexpected errors: ${JSON.stringify(errors)}`).toEqual([])
        }
    })

    it('runs probes in the required order', async () => {
        const outcomes = await runReadProbes({ fhir: conformantFhirClient([]), launch: launchContext() })
        expect(outcomes.map((outcome) => outcome.probeId)).toEqual([
            'patient',
            'practitioner',
            'practitioner-role',
            'organization',
            'encounter',
            'condition',
        ])
    })

    it('threads the Organization reference discovered by PractitionerRole into the Organization probe', async () => {
        const requestedUrls: string[] = []
        const fhir = conformantFhirClient(requestedUrls)

        await runReadProbes({ fhir, launch: launchContext() })

        expect(requestedUrls).toContain(`${BASE_URL}/Organization/org-1`)
    })

    it('skips Organization when PractitionerRole yields no roles at all', async () => {
        const recorder = createExchangeRecorder()
        const http = new SmartHttpClient({
            recorder,
            fetchImpl: (async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString()
                if (url.includes('/PractitionerRole')) return fhirJson(searchBundle([]))
                if (url.includes('/Practitioner/practitioner-456')) return fhirJson(practitioner)
                if (url.includes('/Patient/patient-123')) return fhirJson(patient)
                if (url.includes('/Patient?')) return fhirJson(searchBundle([patient]))
                if (url.includes('/Encounter/encounter-1')) return fhirJson(encounter)
                if (url.includes('/Encounter?')) return fhirJson(searchBundle([encounter]))
                if (url.includes('/Condition?')) return fhirJson(searchBundle([condition]))
                return notFound('Unknown', 'unknown')
            }) as typeof fetch,
        })
        const fhir = new FhirClient({ http, baseUrl: BASE_URL, accessToken: 'token' })

        const outcomes = await runReadProbes({ fhir, launch: launchContext() })
        const organizationOutcome = outcomes.find((outcome) => outcome.probeId === 'organization')

        expect(organizationOutcome?.skipped).toBeDefined()
    })

    it('skips Patient, Practitioner, PractitionerRole and Encounter/Condition subject search when launch context is empty', async () => {
        const fhir = conformantFhirClient([])
        const outcomes = await runReadProbes({
            fhir,
            launch: launchContext({
                patientId: null,
                encounterId: null,
                practitionerId: null,
                fhirUser: null,
            }),
        })

        expect(outcomes.every((outcome) => outcome.skipped !== undefined)).toBe(true)
    })
})
