import { describe, expect, it } from 'vitest'

import type { Severity } from '#validation/validation'

import { validateTokenResponse } from './token-response'

const EXCHANGE_ID = 'exchange-1'

function bySeverity(raw: unknown, requestedScope: string, severity: Severity) {
    return validateTokenResponse(raw, requestedScope, EXCHANGE_ID).filter((v) => v.severity === severity)
}

const FULL_RESPONSE = {
    access_token: 'secret-access-token',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid fhirUser launch patient/Patient.read',
    id_token: 'header.payload.signature',
    refresh_token: 'secret-refresh-token',
    patient: 'patient-123',
    encounter: 'encounter-456',
    need_patient_banner: true,
    smart_style_url: 'https://ehr.example.com/style.json',
    intent: 'sykmelding',
    tenant: 'tenant-1',
}

describe('validateTokenResponse: a fully conformant response', () => {
    const requestedScope = 'openid fhirUser launch offline_access patient/Patient.read'

    it('produces no ERROR or WARNING findings', () => {
        expect(bySeverity(FULL_RESPONSE, requestedScope, 'ERROR')).toEqual([])
        expect(bySeverity(FULL_RESPONSE, requestedScope, 'WARNING')).toEqual([])
    })

    it('reports an OK finding for every satisfied requirement', () => {
        const ok = bySeverity(FULL_RESPONSE, requestedScope, 'OK')
        expect(ok.length).toBeGreaterThanOrEqual(7)
    })

    it('reports INFO for optional fields present in the response', () => {
        const infos = bySeverity(FULL_RESPONSE, requestedScope, 'INFO')
        expect(infos.some((i) => i.message.includes('need_patient_banner'))).toBe(true)
        expect(infos.some((i) => i.message.includes('smart_style_url'))).toBe(true)
        expect(infos.some((i) => i.message.includes('intent'))).toBe(true)
        expect(infos.some((i) => i.message.includes('tenant'))).toBe(true)
    })
})

describe('validateTokenResponse: malformed body shapes', () => {
    it('reports an ERROR when the body is not a JSON object', () => {
        const errors = bySeverity('not an object', 'openid', 'ERROR')
        expect(errors).toHaveLength(1)
        expect(errors[0]?.message).toMatch(/not a JSON object/)
    })

    it('reports an ERROR for a null body', () => {
        const errors = bySeverity(null, 'openid', 'ERROR')
        expect(errors[0]?.message).toMatch(/null/)
    })

    it('reports an ERROR for an array body', () => {
        const errors = bySeverity([1, 2, 3], 'openid', 'ERROR')
        expect(errors).toHaveLength(1)
    })
})

describe('validateTokenResponse: OAuth error response', () => {
    it('surfaces error and error_description and stops further checks', () => {
        const result = validateTokenResponse(
            { error: 'invalid_grant', error_description: 'the authorization code has expired' },
            'openid',
            EXCHANGE_ID,
        )
        expect(result).toHaveLength(1)
        expect(result[0]?.severity).toBe('ERROR')
        expect(result[0]?.message).toContain('invalid_grant')
        expect(result[0]?.message).toContain('the authorization code has expired')
    })

    it('handles an error response with no error_description', () => {
        const [finding] = validateTokenResponse({ error: 'invalid_client' }, 'openid', EXCHANGE_ID)
        expect(finding?.message).toContain('invalid_client')
        expect(finding?.message).toMatch(/no error_description/)
    })
})

describe('validateTokenResponse: access_token', () => {
    it('reports an ERROR when access_token is missing', () => {
        const errors = bySeverity({ token_type: 'Bearer', scope: 'openid' }, 'openid', 'ERROR')
        expect(errors.some((e) => e.message.includes('access_token'))).toBe(true)
    })

    it('reports an ERROR when access_token is an empty string', () => {
        const errors = bySeverity(
            { access_token: '', token_type: 'Bearer', scope: 'openid' },
            'openid',
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('access_token'))).toBe(true)
    })

    it('reports an ERROR when access_token is not a string', () => {
        const errors = bySeverity(
            { access_token: 12345, token_type: 'Bearer', scope: 'openid' },
            'openid',
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('access_token'))).toBe(true)
    })
})

describe('validateTokenResponse: token_type', () => {
    it('reports an ERROR when token_type is missing', () => {
        const errors = bySeverity({ access_token: 'x', scope: 'openid' }, 'openid', 'ERROR')
        expect(errors.some((e) => e.message.includes('token_type'))).toBe(true)
    })

    it('reports a WARNING for a differently-cased Bearer (case-insensitive per RFC 6749)', () => {
        const warnings = bySeverity(
            { access_token: 'x', token_type: 'bearer', scope: 'openid' },
            'openid',
            'WARNING',
        )
        expect(warnings.some((w) => w.message.includes('token_type'))).toBe(true)
    })

    it('reports an ERROR for a completely different scheme', () => {
        const errors = bySeverity(
            { access_token: 'x', token_type: 'MAC', scope: 'openid' },
            'openid',
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('MAC'))).toBe(true)
    })
})

describe('validateTokenResponse: expires_in', () => {
    it('reports a WARNING when expires_in is absent', () => {
        const warnings = bySeverity(
            { access_token: 'x', token_type: 'Bearer', scope: 'openid' },
            'openid',
            'WARNING',
        )
        expect(warnings.some((w) => w.message.includes('expires_in'))).toBe(true)
    })

    it('reports an ERROR when expires_in is not a positive number', () => {
        const errors = bySeverity(
            { access_token: 'x', token_type: 'Bearer', scope: 'openid', expires_in: -5 },
            'openid',
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('expires_in'))).toBe(true)
    })

    it('reports an ERROR when expires_in is a string', () => {
        const errors = bySeverity(
            { access_token: 'x', token_type: 'Bearer', scope: 'openid', expires_in: '3600' },
            'openid',
            'ERROR',
        )
        expect(errors.some((e) => e.message.includes('expires_in'))).toBe(true)
    })
})

describe('validateTokenResponse: scope', () => {
    it('reports an ERROR when scope is missing', () => {
        const errors = bySeverity({ access_token: 'x', token_type: 'Bearer' }, 'openid', 'ERROR')
        expect(errors.some((e) => e.message.includes('`scope`'))).toBe(true)
    })
})

describe('validateTokenResponse: id_token', () => {
    const base = { access_token: 'x', token_type: 'Bearer', scope: 'openid fhirUser' }

    it('reports an ERROR when openid+fhirUser were requested but id_token is missing', () => {
        const errors = bySeverity(base, 'openid fhirUser', 'ERROR')
        expect(errors.some((e) => e.message.includes('id_token'))).toBe(true)
    })

    it('also treats openid+profile as requiring id_token', () => {
        const errors = bySeverity(base, 'openid profile', 'ERROR')
        expect(errors.some((e) => e.message.includes('id_token'))).toBe(true)
    })

    it('does not require id_token when identity scopes were not requested', () => {
        const errors = bySeverity(base, 'patient/Patient.read', 'ERROR')
        expect(errors.some((e) => e.message.includes('id_token'))).toBe(false)
    })
})

describe('validateTokenResponse: refresh_token', () => {
    const base = { access_token: 'x', token_type: 'Bearer', scope: 'offline_access' }

    it('reports a WARNING when offline_access was requested but refresh_token is missing', () => {
        const warnings = bySeverity(base, 'offline_access', 'WARNING')
        expect(warnings.some((w) => w.message.includes('refresh_token'))).toBe(true)
    })

    it('reports a WARNING when online_access was requested but refresh_token is missing', () => {
        const warnings = bySeverity(base, 'online_access', 'WARNING')
        expect(warnings.some((w) => w.message.includes('refresh_token'))).toBe(true)
    })
})

describe('validateTokenResponse: patient and encounter launch context', () => {
    const base = { access_token: 'x', token_type: 'Bearer', scope: 'launch' }

    it('reports an ERROR when launch/patient was requested but patient is missing', () => {
        const errors = bySeverity(base, 'launch/patient', 'ERROR')
        expect(errors.some((e) => e.message.includes('`patient`'))).toBe(true)
    })

    it('reports an ERROR when launch was requested but patient is missing', () => {
        const errors = bySeverity(base, 'launch', 'ERROR')
        expect(errors.some((e) => e.message.includes('`patient`'))).toBe(true)
    })

    it('reports a WARNING citing Nav when launch was requested but encounter is missing', () => {
        const warnings = bySeverity(base, 'launch', 'WARNING')
        const encounterWarning = warnings.find((w) => w.message.includes('`encounter`'))
        expect(encounterWarning).toBeDefined()
        expect(encounterWarning?.message).toContain('Nav requires')
        expect(encounterWarning?.refs?.some((r) => r.authority === 'nav')).toBe(true)
    })

    it('does not require patient/encounter when no launch context scope was requested', () => {
        const errors = bySeverity(base, 'openid', 'ERROR')
        expect(errors.some((e) => e.message.includes('`patient`'))).toBe(false)
        const warnings = bySeverity(base, 'openid', 'WARNING')
        expect(warnings.some((w) => w.message.includes('`encounter`'))).toBe(false)
    })
})

describe('validateTokenResponse: never throws on hostile input', () => {
    it.each([
        [undefined, ''],
        [null, ''],
        [42, ''],
        ['a'.repeat(10_000), 'a'.repeat(10_000)],
        [{ access_token: null, token_type: null, scope: null }, 'openid'],
        [[], 'openid'],
    ])('handles %p safely', (raw, requestedScope) => {
        expect(() => validateTokenResponse(raw, requestedScope, EXCHANGE_ID)).not.toThrow()
    })
})
