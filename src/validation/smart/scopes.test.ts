import { describe, expect, it } from 'vitest'

import type { SmartConfiguration } from '#core/smart/types'
import type { Severity } from '#validation/validation'

import {
    diffScopes,
    parseScope,
    parseScopeString,
    v1EquivalentCruds,
    v2EquivalentV1,
    validateScopes,
    type ClinicalScope,
} from './scopes'

function bySeverity(options: Parameters<typeof validateScopes>[0], severity: Severity) {
    return validateScopes(options).filter((v) => v.severity === severity)
}

describe('parseScope — v1 clinical scopes', () => {
    it.each([
        ['patient/Observation.read', 'patient', 'Observation', 'v1', 'rs'],
        ['user/*.write', 'user', '*', 'v1', 'cud'],
        ['system/Patient.*', 'system', 'Patient', 'v1', 'cruds'],
    ])('parses %s', (raw, compartment, resource, version, cruds) => {
        const scope = parseScope(raw)
        expect(scope.kind).toBe('clinical')
        if (scope.kind !== 'clinical') return
        expect(scope.compartment).toBe(compartment)
        expect(scope.resource).toBe(resource)
        expect(scope.version).toBe(version)
        expect(scope.cruds).toBe(cruds)
        expect(scope.query).toBeNull()
    })
})

describe('parseScope — v2 clinical scopes', () => {
    it('parses a basic CRUDS scope', () => {
        const scope = parseScope('patient/Observation.rs')
        expect(scope).toMatchObject({
            kind: 'clinical',
            version: 'v2',
            cruds: 'rs',
            permissionMalformedOrder: false,
        })
    })

    it('parses a full cruds scope on a wildcard resource', () => {
        const scope = parseScope('user/*.cruds')
        expect(scope).toMatchObject({ kind: 'clinical', version: 'v2', cruds: 'cruds' })
    })

    it('parses a granular sub-scope with a query', () => {
        const scope = parseScope('patient/Observation.rs?category=laboratory')
        expect(scope.kind).toBe('clinical')
        if (scope.kind !== 'clinical') return
        expect(scope.query).toBe('category=laboratory')
        expect(scope.cruds).toBe('rs')
    })

    it('flags CRUDS letters out of canonical order', () => {
        const scope = parseScope('patient/Observation.rsu')
        expect(scope.kind).toBe('clinical')
        if (scope.kind !== 'clinical') return
        expect(scope.permissionMalformedOrder).toBe(true)
    })

    it('flags duplicated CRUDS letters', () => {
        const scope = parseScope('patient/Observation.rr')
        expect(scope.kind).toBe('clinical')
        if (scope.kind !== 'clinical') return
        expect(scope.permissionMalformedOrder).toBe(true)
    })

    it('accepts canonically-ordered CRUDS letters without flagging', () => {
        const scope = parseScope('patient/Observation.cruds')
        expect(scope.kind).toBe('clinical')
        if (scope.kind !== 'clinical') return
        expect(scope.permissionMalformedOrder).toBe(false)
    })
})

describe('parseScope — context, identity, refresh and orchestrate scopes', () => {
    it.each([
        ['launch', 'context'],
        ['launch/patient', 'context'],
        ['launch/encounter', 'context'],
        ['openid', 'identity'],
        ['fhirUser', 'identity'],
        ['profile', 'identity'],
        ['offline_access', 'refresh'],
        ['online_access', 'refresh'],
        ['smart/orchestrate_launch', 'orchestrate'],
    ])('parses %s as kind %s', (raw, kind) => {
        expect(parseScope(raw).kind).toBe(kind)
    })
})

describe('parseScope — hostile input', () => {
    it.each([
        ['patient/', 'malformed'],
        ['patient/Observation.', 'malformed'],
        ['patient/Observation.xyz', 'malformed'],
        ['/.read', 'unrecognised'],
        ['', 'unrecognised'],
        ['a'.repeat(10_000), 'unrecognised'],
        ['patient/Ø.rs', 'malformed'],
        ['user/*.crudsx', 'malformed'],
    ])('does not throw and classifies %s as %s', (raw, expectedKind) => {
        expect(() => parseScope(raw)).not.toThrow()
        expect(parseScope(raw).kind).toBe(expectedKind)
    })

    it('never throws on a huge scope string', () => {
        const huge = Array.from({ length: 5000 }, (_, i) => `patient/Resource${i}.rs`).join(' ')
        expect(() => parseScopeString(huge)).not.toThrow()
        expect(parseScopeString(huge)).toHaveLength(5000)
    })

    it('handles unicode scope tokens without throwing', () => {
        expect(() => parseScope('患者/Observation.rs')).not.toThrow()
        expect(parseScope('患者/Observation.rs').kind).toBe('unrecognised')
    })

    it('tolerates repeated/odd whitespace when splitting a scope string', () => {
        const scopes = parseScopeString('  openid   fhirUser  \n launch ')
        expect(scopes.map((s) => s.raw)).toEqual(['openid', 'fhirUser', 'launch'])
    })

    it('returns an empty array for an empty scope string', () => {
        expect(parseScopeString('')).toEqual([])
        expect(parseScopeString('   ')).toEqual([])
    })
})

describe('v1/v2 equivalence mapping', () => {
    it('maps v1 permissions to their v2 CRUDS equivalent', () => {
        expect(v1EquivalentCruds('read')).toBe('rs')
        expect(v1EquivalentCruds('write')).toBe('cud')
        expect(v1EquivalentCruds('*')).toBe('cruds')
    })

    it('maps v2 CRUDS combinations back to v1 when an equivalent exists', () => {
        expect(v2EquivalentV1('rs')).toBe('read')
        expect(v2EquivalentV1('sr')).toBe('read')
        expect(v2EquivalentV1('cud')).toBe('write')
        expect(v2EquivalentV1('cruds')).toBe('*')
    })

    it('returns null for CRUDS combinations with no v1 equivalent', () => {
        expect(v2EquivalentV1('r')).toBeNull()
        expect(v2EquivalentV1('cu')).toBeNull()
        expect(v2EquivalentV1('rds')).toBeNull()
    })
})

describe('diffScopes', () => {
    it('reports an exact match as as-requested', () => {
        const [entry] = diffScopes('patient/Observation.rs', 'patient/Observation.rs')
        expect(entry).toMatchObject({ status: 'as-requested' })
    })

    it('reports a v1-requested / v2-granted equivalent scope as as-requested', () => {
        const [entry] = diffScopes('patient/Observation.read', 'patient/Observation.rs')
        expect(entry).toMatchObject({ status: 'as-requested' })
    })

    it('reports fewer granted CRUDS letters as narrowed', () => {
        const [entry] = diffScopes('patient/Observation.rs', 'patient/Observation.r')
        expect(entry?.status).toBe('narrowed')
        expect((entry?.granted as ClinicalScope | undefined)?.cruds).toBe('r')
    })

    it('reports a scope missing from the grant entirely as not-granted', () => {
        const [entry] = diffScopes('patient/Observation.rs', '')
        expect(entry).toMatchObject({ status: 'not-granted', granted: null })
    })

    it('reports a granted scope with no corresponding request as ungranted-extra', () => {
        const entries = diffScopes('openid', 'openid patient/Observation.rs')
        const extra = entries.find((e) => e.status === 'ungranted-extra')
        expect(extra?.granted?.raw).toBe('patient/Observation.rs')
    })

    it('flags extra CRUDS letters granted beyond what was requested for the same resource', () => {
        const [entry] = diffScopes('patient/Observation.r', 'patient/Observation.rs')
        expect(entry?.status).toBe('as-requested')
        expect(entry?.extraCruds).toBe('s')
    })

    it('treats a granular query as part of scope identity, not merged with the unqualified resource', () => {
        const entries = diffScopes('patient/Observation.rs?category=laboratory', 'patient/Observation.rs')
        expect(entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ status: 'not-granted' }),
                expect.objectContaining({ status: 'ungranted-extra' }),
            ]),
        )
    })
})

describe('validateScopes', () => {
    const baseConfig: SmartConfiguration = {
        capabilities: ['permission-v1', 'permission-v2'],
    }

    it('reports an ERROR when a Nav-required scope was not granted at all', () => {
        const errors = bySeverity(
            {
                requestedScope: 'openid fhirUser launch patient/Patient.read',
                grantedScope: 'openid fhirUser launch',
                smartConfiguration: baseConfig,
            },
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('patient/Patient.read'))).toBe(true)
        expect(errors.some((e) => e.message.includes('Nav requires'))).toBe(true)
    })

    it('reports a WARNING (not an ERROR) when a non-Nav-required scope was not granted', () => {
        const results = validateScopes({
            requestedScope: 'patient/Observation.rs',
            grantedScope: '',
            smartConfiguration: baseConfig,
        })
        expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'WARNING' })]))
        expect(results.some((r) => r.severity === 'ERROR')).toBe(false)
    })

    it('reports an ERROR when a Nav-required scope was narrowed below what Nav needs', () => {
        const errors = bySeverity(
            {
                requestedScope: 'patient/Patient.read',
                grantedScope: 'patient/Patient.u',
                smartConfiguration: baseConfig,
            },
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('narrowed'))).toBe(true)
    })

    it('reports INFO when a v2 scope is downgraded to its v1 equivalent', () => {
        const infos = bySeverity(
            {
                requestedScope: 'patient/Observation.rs',
                grantedScope: 'patient/Observation.read',
                smartConfiguration: baseConfig,
            },
            'INFO',
        )
        expect(infos.some((i) => i.message.includes('v1-equivalent'))).toBe(true)
    })

    it('reports OK for a scope granted exactly as requested', () => {
        const oks = bySeverity(
            {
                requestedScope: 'openid',
                grantedScope: 'openid',
                smartConfiguration: baseConfig,
            },
            'OK',
        )
        expect(oks.some((o) => o.message.includes('granted as requested'))).toBe(true)
    })

    it('reports a WARNING when the server grants more than was requested', () => {
        const warnings = bySeverity(
            {
                requestedScope: 'openid',
                grantedScope: 'openid patient/Patient.cruds',
                smartConfiguration: baseConfig,
            },
            'WARNING',
        )
        expect(warnings.some((w) => w.message.includes('never requested'))).toBe(true)
    })

    it('reports ERROR for a malformed requested scope string', () => {
        const errors = bySeverity(
            {
                requestedScope: 'patient/Observation.xyz',
                grantedScope: '',
                smartConfiguration: baseConfig,
            },
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('malformed'))).toBe(true)
    })

    it('does not also report a redundant not-granted finding for a malformed scope', () => {
        const results = validateScopes({
            requestedScope: 'patient/Observation.xyz',
            grantedScope: '',
            smartConfiguration: baseConfig,
        })
        expect(results).toHaveLength(1)
        expect(results[0]?.message).toContain('malformed')
    })

    it('reports WARNING when v1 syntax is granted without the server advertising permission-v1', () => {
        const warnings = bySeverity(
            {
                requestedScope: 'patient/Observation.read',
                grantedScope: 'patient/Observation.read',
                smartConfiguration: { capabilities: ['permission-v2'] },
            },
            'WARNING',
        )
        expect(warnings.some((w) => w.message.includes('permission-v1'))).toBe(true)
    })

    it('reports WARNING when v2 syntax is granted without the server advertising permission-v2', () => {
        const warnings = bySeverity(
            {
                requestedScope: 'patient/Observation.rs',
                grantedScope: 'patient/Observation.rs',
                smartConfiguration: { capabilities: ['permission-v1'] },
            },
            'WARNING',
        )
        expect(warnings.some((w) => w.message.includes('permission-v2'))).toBe(true)
    })

    it('never throws for a huge or hostile requested/granted scope pair', () => {
        expect(() =>
            validateScopes({
                requestedScope: 'a'.repeat(10_000),
                grantedScope: '/.read patient/ patient/Observation.',
                smartConfiguration: {},
            }),
        ).not.toThrow()
    })
})
