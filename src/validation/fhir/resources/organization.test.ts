import type { Organization } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'
import type { PractitionerRoleDiscovery } from '#validation/fhir/resources/practitioner-role'

import { createOrganizationProbe, validateOrganizationResource } from './organization'

const BASE_URL = 'https://ehr.example.com/fhir'

function launchContext(overrides: Partial<LaunchContext> = {}): LaunchContext {
    return {
        patientId: null,
        encounterId: null,
        fhirUser: null,
        practitionerId: 'practitioner-456',
        grantedScopes: ['patient/Organization.rs'],
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

const validOrganization: Organization = {
    resourceType: 'Organization',
    id: 'org-1',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Organization'] },
    identifier: [{ system: 'urn:oid:2.16.578.1.12.4.1.4.101', value: '987654325' }],
    telecom: [{ system: 'phone', value: '12345678' }],
}

describe('validateOrganizationResource', () => {
    it('has no violations for a conformant no-basis-Organization', () => {
        const violations = validateOrganizationResource(validOrganization).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('errors when meta.profile is missing no-basis-Organization', () => {
        const { meta: _meta, ...rest } = validOrganization
        const violations = validateOrganizationResource(rest as Organization)
        expect(
            violations.some((v) => v.severity === 'ERROR' && v.message.includes('no-basis-Organization')),
        ).toBe(true)
    })

    it('errors when the organisasjonsnummer identifier is missing', () => {
        const organization: Organization = { ...validOrganization, identifier: [] }
        const violations = validateOrganizationResource(organization)
        expect(
            violations.some((v) => v.severity === 'ERROR' && v.message.includes('2.16.578.1.12.4.1.4.101')),
        ).toBe(true)
    })

    it('errors when there is no phone telecom entry', () => {
        const organization: Organization = { ...validOrganization, telecom: [] }
        const violations = validateOrganizationResource(organization)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('phone'))).toBe(true)
    })

    it('errors when the phone telecom entry has no value', () => {
        const organization: Organization = { ...validOrganization, telecom: [{ system: 'phone' }] }
        const violations = validateOrganizationResource(organization)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('value'))).toBe(true)
    })
})

describe('createOrganizationProbe', () => {
    it('is skipped when no organization reference was discovered', async () => {
        const discovery: PractitionerRoleDiscovery = { organizationReference: null }
        const probe = createOrganizationProbe(discovery)
        const fhir = fhirClientFor(() => fhirJson(validOrganization))

        const outcome = await probe.run({ fhir, launch: launchContext() })

        expect(outcome.skipped).toBeDefined()
    })

    it('reads Organization/{id} from the discovered reference', async () => {
        const discovery: PractitionerRoleDiscovery = { organizationReference: 'Organization/org-1' }
        const probe = createOrganizationProbe(discovery)
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            return fhirJson(validOrganization)
        })

        const outcome = await probe.run({ fhir, launch: launchContext() })

        expect(requestedUrls).toEqual([`${BASE_URL}/Organization/org-1`])
        expect(outcome.validations.every((v) => v.severity !== 'ERROR')).toBe(true)
    })

    it('reports an ERROR when the discovered Organization is missing an orgnr', async () => {
        const discovery: PractitionerRoleDiscovery = { organizationReference: 'Organization/org-1' }
        const probe = createOrganizationProbe(discovery)
        const fhir = fhirClientFor(() => fhirJson({ ...validOrganization, identifier: [] }))

        const outcome = await probe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
    })
})
