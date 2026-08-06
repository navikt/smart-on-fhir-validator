import type { Practitioner } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'

import { practitionerProbe, validatePractitionerResource } from './practitioner'

const BASE_URL = 'https://ehr.example.com/fhir'

function launchContext(overrides: Partial<LaunchContext> = {}): LaunchContext {
    return {
        patientId: null,
        encounterId: null,
        fhirUser: 'Practitioner/practitioner-456',
        practitionerId: 'practitioner-456',
        grantedScopes: ['patient/Practitioner.rs'],
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

const validPractitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: 'practitioner-456',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner'] },
    identifier: [{ system: 'urn:oid:2.16.578.1.12.4.1.4.4', value: '9144889' }],
    name: [{ family: 'Jarvery', given: ['Sidsel'] }],
}

describe('validatePractitionerResource', () => {
    it('has no violations for a conformant no-basis-Practitioner', () => {
        const violations = validatePractitionerResource(validPractitioner).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('errors when meta.profile is missing no-basis-Practitioner', () => {
        const { meta: _meta, ...rest } = validPractitioner
        const violations = validatePractitionerResource(rest as Practitioner)
        expect(
            violations.some((v) => v.severity === 'ERROR' && v.message.includes('no-basis-Practitioner')),
        ).toBe(true)
    })

    it('errors when the HPR identifier is missing', () => {
        const practitioner: Practitioner = { ...validPractitioner, identifier: [] }
        const violations = validatePractitionerResource(practitioner)
        expect(
            violations.some((v) => v.severity === 'ERROR' && v.message.includes('2.16.578.1.12.4.1.4.4')),
        ).toBe(true)
    })
})

describe('practitionerProbe', () => {
    it('is skipped when launch context has no practitioner id', async () => {
        const fhir = fhirClientFor(() => fhirJson(validPractitioner))
        const outcome = await practitionerProbe.run({ fhir, launch: launchContext({ practitionerId: null }) })

        expect(outcome.skipped).toBeDefined()
        expect(outcome.validations).toEqual([])
    })

    it('reads Practitioner/{id} derived from fhirUser and validates the resource', async () => {
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            return fhirJson(validPractitioner)
        })

        const outcome = await practitionerProbe.run({ fhir, launch: launchContext() })

        expect(requestedUrls).toEqual([`${BASE_URL}/Practitioner/practitioner-456`])
        expect(outcome.validations.every((v) => v.severity !== 'ERROR')).toBe(true)
    })

    it('reports an ERROR when the HPR identifier is missing', async () => {
        const fhir = fhirClientFor(() => fhirJson({ ...validPractitioner, identifier: [] }))
        const outcome = await practitionerProbe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
    })

    it('reports 403 as an ERROR mentioning granted scopes', async () => {
        const fhir = fhirClientFor(() =>
            fhirJson(
                { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] },
                403,
            ),
        )

        const outcome = await practitionerProbe.run({
            fhir,
            launch: launchContext({ grantedScopes: ['patient/Patient.rs'] }),
        })

        expect(outcome.validations.some((v) => v.severity === 'ERROR' && v.message.includes('403'))).toBe(
            true,
        )
    })
})
