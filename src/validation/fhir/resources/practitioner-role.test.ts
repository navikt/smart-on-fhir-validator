import type { PractitionerRole } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { FhirClient, buildSearchUrl } from '#core/fhir/client'
import { SmartHttpClient } from '#core/http/smart-http-client'
import type { LaunchContext } from '#core/smart/types'

import {
    createPractitionerRoleProbe,
    firstOrganizationReference,
    validatePractitionerRoleResource,
} from './practitioner-role'

const BASE_URL = 'https://ehr.example.com/fhir'

function launchContext(overrides: Partial<LaunchContext> = {}): LaunchContext {
    return {
        patientId: null,
        encounterId: null,
        fhirUser: 'Practitioner/practitioner-456',
        practitionerId: 'practitioner-456',
        grantedScopes: ['patient/PractitionerRole.rs'],
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

const validRole: PractitionerRole = {
    resourceType: 'PractitionerRole',
    id: 'role-1',
    meta: { profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-PractitionerRole'] },
    practitioner: { reference: 'Practitioner/practitioner-456' },
    organization: { reference: 'Organization/org-1' },
}

function searchBundle(entries: PractitionerRole[]) {
    return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: entries.length,
        entry: entries.map((resource) => ({ resource, search: { mode: 'match' } })),
    }
}

describe('validatePractitionerRoleResource', () => {
    it('has no violations for a conformant no-basis-PractitionerRole', () => {
        const violations = validatePractitionerRoleResource(validRole).filter((v) => v.severity !== 'OK')
        expect(violations).toEqual([])
    })

    it('errors when meta.profile is missing no-basis-PractitionerRole', () => {
        const { meta: _meta, ...rest } = validRole
        const violations = validatePractitionerRoleResource(rest as PractitionerRole)
        expect(
            violations.some((v) => v.severity === 'ERROR' && v.message.includes('no-basis-PractitionerRole')),
        ).toBe(true)
    })

    it('errors when the practitioner reference is missing', () => {
        const role: PractitionerRole = { ...validRole, practitioner: undefined }
        const violations = validatePractitionerRoleResource(role)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('practitioner'))).toBe(
            true,
        )
    })

    it('errors when the organization reference is missing', () => {
        const role: PractitionerRole = { ...validRole, organization: undefined }
        const violations = validatePractitionerRoleResource(role)
        expect(violations.some((v) => v.severity === 'ERROR' && v.message.includes('organization'))).toBe(
            true,
        )
    })

    it('errors when a reference does not start with the expected resource type', () => {
        const role: PractitionerRole = { ...validRole, organization: { reference: 'org-1' } }
        const violations = validatePractitionerRoleResource(role)
        expect(
            violations.some((v) => v.severity === 'ERROR' && v.message.includes('does not start with')),
        ).toBe(true)
    })
})

describe('firstOrganizationReference', () => {
    it('returns the first well-formed Organization reference', () => {
        expect(firstOrganizationReference([validRole])).toBe('Organization/org-1')
    })

    it('returns null when no role has an organization reference', () => {
        expect(firstOrganizationReference([{ ...validRole, organization: undefined }])).toBeNull()
    })
})

describe('createPractitionerRoleProbe', () => {
    it('is skipped when launch context has no practitioner id', async () => {
        const discovery = { organizationReference: null }
        const probe = createPractitionerRoleProbe(discovery)
        const fhir = fhirClientFor(() => fhirJson(searchBundle([validRole])))

        const outcome = await probe.run({ fhir, launch: launchContext({ practitionerId: null }) })

        expect(outcome.skipped).toBeDefined()
    })

    it('searches practitioner=Practitioner/{id} built from launch context', async () => {
        const discovery = { organizationReference: null }
        const probe = createPractitionerRoleProbe(discovery)
        const requestedUrls: string[] = []
        const fhir = fhirClientFor((url) => {
            requestedUrls.push(url)
            return fhirJson(searchBundle([validRole]))
        })

        await probe.run({ fhir, launch: launchContext() })

        const expectedUrl = buildSearchUrl(BASE_URL, 'PractitionerRole', {
            practitioner: 'Practitioner/practitioner-456',
        })
        expect(requestedUrls).toEqual([expectedUrl])
    })

    it('records the discovered organization reference for the Organization probe', async () => {
        const discovery = { organizationReference: null }
        const probe = createPractitionerRoleProbe(discovery)
        const fhir = fhirClientFor(() => fhirJson(searchBundle([validRole])))

        await probe.run({ fhir, launch: launchContext() })

        expect(discovery.organizationReference).toBe('Organization/org-1')
    })

    it('reports an ERROR and leaves the discovery null when no role matches', async () => {
        const discovery = { organizationReference: null }
        const probe = createPractitionerRoleProbe(discovery)
        const fhir = fhirClientFor(() => fhirJson(searchBundle([])))

        const outcome = await probe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.severity === 'ERROR')).toBe(true)
        expect(discovery.organizationReference).toBeNull()
    })

    it('validates every matched role', async () => {
        const discovery = { organizationReference: null }
        const probe = createPractitionerRoleProbe(discovery)
        const fhir = fhirClientFor(() =>
            fhirJson(searchBundle([{ ...validRole, id: 'role-2', organization: undefined }])),
        )

        const outcome = await probe.run({ fhir, launch: launchContext() })

        expect(outcome.validations.some((v) => v.severity === 'ERROR' && v.message.includes('role-2'))).toBe(
            true,
        )
    })
})
