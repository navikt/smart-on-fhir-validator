import { describe, expect, it } from 'vitest'

import type { SmartConfiguration } from '#core/smart/types'
import type { Severity } from '#validation/validation'

import { parseCapabilities, validateCapabilitySets } from './capabilities'

function bySeverity(config: SmartConfiguration, severity: Severity) {
    return validateCapabilitySets(config).filter((v) => v.severity === severity)
}

describe('parseCapabilities', () => {
    it('splits known SMART capabilities from unrecognized ones', () => {
        const result = parseCapabilities({
            capabilities: [
                'launch-ehr',
                'permission-v2',
                'http://sdo.example.org/example-new-capability',
                'bogus',
            ],
        })

        expect(result.known).toEqual(['launch-ehr', 'permission-v2'])
        expect(result.unknown).toEqual(['http://sdo.example.org/example-new-capability', 'bogus'])
    })

    it('returns empty results for an absent capabilities field', () => {
        expect(parseCapabilities({})).toEqual({ known: [], unknown: [] })
    })

    it('treats capabilities given as a string instead of an array as empty, rather than throwing', () => {
        const config = { capabilities: 'launch-ehr' } as unknown as SmartConfiguration

        expect(() => parseCapabilities(config)).not.toThrow()
        expect(parseCapabilities(config)).toEqual({ known: [], unknown: [] })
    })

    it('drops non-string entries from a hostile capabilities array', () => {
        const config = {
            capabilities: ['launch-ehr', 42, null, { evil: true }],
        } as unknown as SmartConfiguration

        expect(parseCapabilities(config)).toEqual({ known: ['launch-ehr'], unknown: [] })
    })

    it('returns empty results for null or undefined capabilities', () => {
        expect(parseCapabilities({ capabilities: undefined })).toEqual({ known: [], unknown: [] })
        expect(parseCapabilities({ capabilities: null } as unknown as SmartConfiguration)).toEqual({
            known: [],
            unknown: [],
        })
    })
})

describe('validateCapabilitySets — fully conformant server (all four sets satisfied)', () => {
    const config: SmartConfiguration = {
        capabilities: [
            'launch-ehr',
            'launch-standalone',
            'client-public',
            'client-confidential-symmetric',
            'context-ehr-patient',
            'context-ehr-encounter',
            'context-standalone-patient',
            'permission-patient',
            'permission-user',
            'permission-v1',
            'permission-v2',
        ],
    }

    it('produces no ERROR findings', () => {
        expect(bySeverity(config, 'ERROR')).toEqual([])
    })

    it('reports every capability set, including the Nav target, as satisfied (OK)', () => {
        const okMessages = bySeverity(config, 'OK').map((v) => v.message)

        expect(okMessages.some((m) => m.includes('Clinician Access for EHR Launch'))).toBe(true)
        expect(okMessages.some((m) => m.includes('Patient Access for Standalone Apps'))).toBe(true)
        expect(okMessages.some((m) => m.includes('Patient Access for EHR Launch'))).toBe(true)
        expect(okMessages.some((m) => m.includes('Clinician Access for Standalone'))).toBe(true)
    })

    it('reports the required client type and both permission syntaxes as OK', () => {
        const okMessages = bySeverity(config, 'OK').map((v) => v.message)

        expect(okMessages.some((m) => m.includes('client-public'))).toBe(true)
        expect(okMessages.some((m) => m.includes('permission-v2'))).toBe(true)
        expect(okMessages.some((m) => m.includes('permission-v1'))).toBe(true)
    })
})

describe('validateCapabilitySets — server advertising nothing', () => {
    const config: SmartConfiguration = { capabilities: [] }

    it('errors on the missing client type', () => {
        const errors = bySeverity(config, 'ERROR').map((v) => v.message)
        expect(
            errors.some((m) => m.includes('client-public') && m.includes('client-confidential-symmetric')),
        ).toBe(true)
    })

    it("errors specifically on Nav's target capability set, Clinician Access for EHR Launch", () => {
        const errors = bySeverity(config, 'ERROR').map((v) => v.message)
        expect(errors.some((m) => m.includes('Clinician Access for EHR Launch'))).toBe(true)
    })

    it('only reports INFO, not ERROR, for the three non-Nav capability sets', () => {
        const findings = validateCapabilitySets(config)
        const infoMessages = findings.filter((v) => v.severity === 'INFO').map((v) => v.message)
        const errorMessages = findings.filter((v) => v.severity === 'ERROR').map((v) => v.message)

        expect(infoMessages.some((m) => m.includes('Patient Access for Standalone Apps'))).toBe(true)
        expect(infoMessages.some((m) => m.includes('Patient Access for EHR Launch'))).toBe(true)
        expect(infoMessages.some((m) => m.includes('Clinician Access for Standalone'))).toBe(true)
        expect(errorMessages.some((m) => m.includes('Patient Access for Standalone Apps'))).toBe(false)
    })

    it('warns about missing permission-v2 and notes missing permission-v1 as INFO', () => {
        const warnings = bySeverity(config, 'WARNING').map((v) => v.message)
        const infos = bySeverity(config, 'INFO').map((v) => v.message)

        expect(warnings.some((m) => m.includes('permission-v2'))).toBe(true)
        expect(infos.some((m) => m.includes('permission-v1'))).toBe(true)
    })
})

describe('validateCapabilitySets — client type requirement', () => {
    it('is satisfied by client-public alone', () => {
        const errors = bySeverity({ capabilities: ['client-public'] }, 'ERROR').map((v) => v.message)
        expect(errors.some((m) => m.includes('client type') || m.includes('client-public'))).toBe(false)
    })

    it('is satisfied by client-confidential-symmetric alone', () => {
        const errors = bySeverity({ capabilities: ['client-confidential-symmetric'] }, 'ERROR').map(
            (v) => v.message,
        )
        expect(errors.some((m) => m.includes('every SMART capability set requires at least one'))).toBe(false)
    })

    it('is NOT satisfied by client-confidential-asymmetric alone (only public/symmetric count)', () => {
        const errors = bySeverity({ capabilities: ['client-confidential-asymmetric'] }, 'ERROR').map(
            (v) => v.message,
        )
        expect(errors.some((m) => m.includes('every SMART capability set requires at least one'))).toBe(true)
    })
})

describe('validateCapabilitySets — non-URI custom capability strings', () => {
    it('warns when a server advertises a simple, non-URI custom capability string', () => {
        const warnings = bySeverity({ capabilities: ['launch-ehr', 'my-custom-capability'] }, 'WARNING').map(
            (v) => v.message,
        )

        expect(warnings.some((m) => m.includes('my-custom-capability') && m.includes('full URIs'))).toBe(true)
    })

    it('does not warn, but reports INFO, for a properly namespaced URI capability', () => {
        const warnings = bySeverity(
            { capabilities: ['launch-ehr', 'http://sdo.example.org/example-new-capability'] },
            'WARNING',
        ).map((v) => v.message)
        const infos = bySeverity(
            { capabilities: ['launch-ehr', 'http://sdo.example.org/example-new-capability'] },
            'INFO',
        ).map((v) => v.message)

        expect(warnings.some((m) => m.includes('http://sdo.example.org'))).toBe(false)
        expect(infos.some((m) => m.includes('http://sdo.example.org/example-new-capability'))).toBe(true)
    })
})

describe('validateCapabilitySets — hostile input', () => {
    it('does not throw when capabilities is a string instead of an array', () => {
        const config = { capabilities: 'launch-ehr' } as unknown as SmartConfiguration

        expect(() => validateCapabilitySets(config)).not.toThrow()
        expect(bySeverity(config, 'ERROR').length).toBeGreaterThan(0)
    })

    it('does not throw for a completely empty configuration', () => {
        expect(() => validateCapabilitySets({})).not.toThrow()
    })
})
