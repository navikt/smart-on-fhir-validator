import { describe, expect, it } from 'vitest'

import type { TokenResponse } from '#core/smart/types'

import { buildLaunchContext } from './launch-context'

const BASE_TOKEN_RESPONSE: TokenResponse = {
    access_token: 'secret',
    token_type: 'Bearer',
    scope: 'openid fhirUser launch patient/Patient.read',
}

describe('buildLaunchContext — happy path', () => {
    it('builds a full launch context from patient/encounter/fhirUser', () => {
        const { launchContext, validations } = buildLaunchContext(
            { ...BASE_TOKEN_RESPONSE, patient: 'patient-1', encounter: 'encounter-1' },
            { fhirUser: 'Practitioner/42' },
        )

        expect(launchContext).toEqual({
            patientId: 'patient-1',
            encounterId: 'encounter-1',
            fhirUser: 'Practitioner/42',
            practitionerId: '42',
            grantedScopes: ['openid', 'fhirUser', 'launch', 'patient/Patient.read'],
        })
        expect(validations.some((v) => v.severity === 'ERROR')).toBe(false)
    })

    it('resolves an absolute-URL fhirUser reference', () => {
        const { launchContext } = buildLaunchContext(BASE_TOKEN_RESPONSE, {
            fhirUser: 'https://ehr.example.org/fhir/Practitioner/99',
        })
        expect(launchContext.practitionerId).toBe('99')
    })

    it('falls back to the token response fhirUser when id_token claims are null', () => {
        const { launchContext } = buildLaunchContext(
            { ...BASE_TOKEN_RESPONSE, fhirUser: 'Practitioner/7' },
            null,
        )
        expect(launchContext.fhirUser).toBe('Practitioner/7')
        expect(launchContext.practitionerId).toBe('7')
    })

    it('prefers the id_token fhirUser claim over the token response field', () => {
        const { launchContext } = buildLaunchContext(
            { ...BASE_TOKEN_RESPONSE, fhirUser: 'Practitioner/stale' },
            {
                fhirUser: 'Practitioner/fresh',
            },
        )
        expect(launchContext.fhirUser).toBe('Practitioner/fresh')
        expect(launchContext.practitionerId).toBe('fresh')
    })
})

describe('buildLaunchContext — missing context', () => {
    it('reports a WARNING and leaves patientId null when patient is absent', () => {
        const { launchContext, validations } = buildLaunchContext(BASE_TOKEN_RESPONSE, null)
        expect(launchContext.patientId).toBeNull()
        expect(
            validations.some((v) => v.severity === 'WARNING' && v.message.includes('Patient-context')),
        ).toBe(true)
    })

    it('reports a WARNING citing Nav and leaves encounterId null when encounter is absent', () => {
        const { launchContext, validations } = buildLaunchContext(BASE_TOKEN_RESPONSE, null)
        expect(launchContext.encounterId).toBeNull()
        const encounterWarning = validations.find((v) => v.message.includes('Encounter and Condition probes'))
        expect(encounterWarning).toBeDefined()
        expect(encounterWarning?.severity).toBe('WARNING')
        expect(encounterWarning?.message).toContain('Nav requires')
        expect(encounterWarning?.refs?.nav).toBeDefined()
    })

    it('reports a WARNING when no fhirUser is available at all', () => {
        const { launchContext, validations } = buildLaunchContext(BASE_TOKEN_RESPONSE, null)
        expect(launchContext.fhirUser).toBeNull()
        expect(launchContext.practitionerId).toBeNull()
        expect(
            validations.some(
                (v) => v.severity === 'WARNING' && v.message.includes('No `fhirUser` is available'),
            ),
        ).toBe(true)
    })

    it('reports INFO when fhirUser resolves to a non-Practitioner resource', () => {
        const { launchContext, validations } = buildLaunchContext(BASE_TOKEN_RESPONSE, {
            fhirUser: 'Patient/1',
        })
        expect(launchContext.practitionerId).toBeNull()
        expect(launchContext.fhirUser).toBe('Patient/1')
        expect(
            validations.some((v) => v.severity === 'INFO' && v.message.includes('not a Practitioner')),
        ).toBe(true)
    })

    it('reports a WARNING when fhirUser is not a parseable reference', () => {
        const { launchContext, validations } = buildLaunchContext(BASE_TOKEN_RESPONSE, {
            fhirUser: 'not-a-reference',
        })
        expect(launchContext.practitionerId).toBeNull()
        expect(
            validations.some(
                (v) => v.severity === 'WARNING' && v.message.includes('not a parseable FHIR reference'),
            ),
        ).toBe(true)
    })

    it('reports a WARNING when the granted scope string is empty', () => {
        const { launchContext, validations } = buildLaunchContext({ ...BASE_TOKEN_RESPONSE, scope: '' }, null)
        expect(launchContext.grantedScopes).toEqual([])
        expect(validations.some((v) => v.message.includes('granted `scope` string is empty'))).toBe(true)
    })
})

describe('buildLaunchContext — hostile input', () => {
    it('never throws for a non-string fhirUser claim', () => {
        expect(() =>
            buildLaunchContext(BASE_TOKEN_RESPONSE, { fhirUser: 12345 as unknown as string }),
        ).not.toThrow()
        const { launchContext } = buildLaunchContext(BASE_TOKEN_RESPONSE, {
            fhirUser: 12345 as unknown as string,
        })
        expect(launchContext.fhirUser).toBeNull()
    })

    it('never throws for a scope string with irregular whitespace', () => {
        expect(() => buildLaunchContext({ ...BASE_TOKEN_RESPONSE, scope: '  a   b  ' }, null)).not.toThrow()
        const { launchContext } = buildLaunchContext({ ...BASE_TOKEN_RESPONSE, scope: '  a   b  ' }, null)
        expect(launchContext.grantedScopes).toEqual(['a', 'b'])
    })
})
