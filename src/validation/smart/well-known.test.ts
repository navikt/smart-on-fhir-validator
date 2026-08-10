import { describe, expect, it } from 'vitest'

import type { SmartConfiguration } from '#core/smart/types'
import type { Severity } from '#validation/validation'

import { validateSmartConfiguration } from './well-known'

const EXCHANGE_ID = 'exchange-123'

function bySeverity(config: SmartConfiguration, severity: Severity) {
    return validateSmartConfiguration(config, EXCHANGE_ID).filter((v) => v.severity === severity)
}

/** Mirrors the sample response from the SMART App Launch conformance page, verbatim. */
const CONFORMANT_CONFIG: SmartConfiguration = {
    issuer: 'https://ehr.example.com',
    jwks_uri: 'https://ehr.example.com/.well-known/jwks.json',
    authorization_endpoint: 'https://ehr.example.com/auth/authorize',
    token_endpoint: 'https://ehr.example.com/auth/token',
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'private_key_jwt'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    registration_endpoint: 'https://ehr.example.com/auth/register',
    scopes_supported: [
        'openid',
        'profile',
        'launch',
        'launch/patient',
        'patient/*.rs',
        'user/*.rs',
        'offline_access',
    ],
    response_types_supported: ['code'],
    management_endpoint: 'https://ehr.example.com/user/manage',
    introspection_endpoint: 'https://ehr.example.com/user/introspect',
    revocation_endpoint: 'https://ehr.example.com/user/revoke',
    code_challenge_methods_supported: ['S256'],
    capabilities: [
        'launch-ehr',
        'permission-patient',
        'permission-v2',
        'client-public',
        'client-confidential-symmetric',
        'context-ehr-patient',
        'sso-openid-connect',
    ],
    user_access_brand_bundle: 'https://ehr.example.com/brand-bundle.json',
    user_access_brand_identifier: 'https://ehr.example.com#brand-1',
    associated_endpoints: [{ url: 'https://state.example.com', capabilities: ['smart-app-state'] }],
}

describe('validateSmartConfiguration — fully conformant document', () => {
    it('produces no ERROR or WARNING findings', () => {
        expect(bySeverity(CONFORMANT_CONFIG, 'ERROR')).toEqual([])
        expect(bySeverity(CONFORMANT_CONFIG, 'WARNING')).toEqual([])
    })

    it('produces an OK finding for every requirement it satisfies', () => {
        const okMessages = bySeverity(CONFORMANT_CONFIG, 'OK').map((v) => v.message)

        expect(okMessages).toContain('`token_endpoint` is present, as required')
        expect(okMessages).toContain('`capabilities` is present, as required')
        expect(okMessages).toContain('`code_challenge_methods_supported` includes `S256`, as required')
        expect(okMessages).toContain('`grant_types_supported` includes `authorization_code`')
        expect(okMessages.some((m) => m.includes('correctly excludes `plain`'))).toBe(true)
    })

    it('attaches a spec ref to every finding', () => {
        const findings = validateSmartConfiguration(CONFORMANT_CONFIG, EXCHANGE_ID)

        expect(findings.length).toBeGreaterThan(0)
        for (const finding of findings) {
            expect(finding.refs?.length).toBeGreaterThan(0)
            expect(
                finding.refs?.every((r) =>
                    r.href.startsWith('https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html#'),
                ),
            ).toBe(true)
        }
    })
})

describe('validateSmartConfiguration — empty document', () => {
    const findings = () => validateSmartConfiguration({}, EXCHANGE_ID)

    it('flags every REQUIRED field as an ERROR', () => {
        const messages = bySeverity({}, 'ERROR').map((v) => v.message)

        expect(messages.some((m) => m.includes('`grant_types_supported`'))).toBe(true)
        expect(messages.some((m) => m.includes('`token_endpoint`'))).toBe(true)
        expect(messages.some((m) => m.includes('`capabilities`'))).toBe(true)
        expect(messages.some((m) => m.includes('`code_challenge_methods_supported`'))).toBe(true)
        expect(bySeverity({}, 'ERROR')).toHaveLength(4)
    })

    it('does not flag CONDITIONAL fields when their triggering capability is absent', () => {
        const messages = findings().map((v) => v.message)

        expect(messages.some((m) => m.includes('`issuer`'))).toBe(false)
        expect(messages.some((m) => m.includes('`jwks_uri`'))).toBe(false)
        expect(messages.some((m) => m.includes('`authorization_endpoint`'))).toBe(false)
    })

    it('flags every RECOMMENDED field as a WARNING', () => {
        expect(bySeverity({}, 'WARNING')).toHaveLength(7)
    })

    it('flags every OPTIONAL field as INFO', () => {
        const infoMessages = bySeverity({}, 'INFO').map((v) => v.message)

        expect(infoMessages.some((m) => m.includes('`token_endpoint_auth_methods_supported`'))).toBe(true)
        expect(infoMessages.some((m) => m.includes('`registration_endpoint`'))).toBe(true)
        expect(infoMessages.some((m) => m.includes('`associated_endpoints`'))).toBe(true)
    })

    it('produces no OK findings at all', () => {
        expect(bySeverity({}, 'OK')).toEqual([])
    })
})

describe('validateSmartConfiguration — CONDITIONAL requirements', () => {
    it('requires issuer and jwks_uri when sso-openid-connect is advertised', () => {
        const errors = bySeverity(
            {
                capabilities: ['sso-openid-connect'],
                token_endpoint: 'https://x',
                grant_types_supported: [],
                code_challenge_methods_supported: [],
            },
            'ERROR',
        ).map((v) => v.message)

        expect(errors.some((m) => m.includes('`issuer`') && m.includes('sso-openid-connect'))).toBe(true)
        expect(errors.some((m) => m.includes('`jwks_uri`') && m.includes('sso-openid-connect'))).toBe(true)
    })

    it('does not require issuer/jwks_uri when sso-openid-connect is absent', () => {
        const errors = bySeverity({ capabilities: ['launch-ehr'] }, 'ERROR').map((v) => v.message)

        expect(errors.some((m) => m.includes('`issuer`'))).toBe(false)
        expect(errors.some((m) => m.includes('`jwks_uri`'))).toBe(false)
    })

    it.each(['launch-ehr', 'launch-standalone'])(
        'requires authorization_endpoint when %s is advertised',
        (capability) => {
            const errors = bySeverity({ capabilities: [capability] }, 'ERROR').map((v) => v.message)

            expect(errors.some((m) => m.includes('`authorization_endpoint`'))).toBe(true)
        },
    )

    it('is satisfied when the conditionally-required fields are present', () => {
        const errors = bySeverity(
            {
                capabilities: ['sso-openid-connect', 'launch-ehr'],
                issuer: 'https://ehr.example.com',
                jwks_uri: 'https://ehr.example.com/jwks',
                authorization_endpoint: 'https://ehr.example.com/authorize',
            },
            'ERROR',
        ).map((v) => v.message)

        expect(errors.some((m) => m.includes('`issuer`'))).toBe(false)
        expect(errors.some((m) => m.includes('`jwks_uri`'))).toBe(false)
        expect(errors.some((m) => m.includes('`authorization_endpoint`'))).toBe(false)
    })
})

describe('validateSmartConfiguration — code_challenge_methods_supported', () => {
    it('errors when S256 is missing', () => {
        const errors = bySeverity({ code_challenge_methods_supported: ['plain'] }, 'ERROR').map(
            (v) => v.message,
        )

        expect(errors.some((m) => m.includes('does not include `S256`'))).toBe(true)
    })

    it('errors when plain is included, even alongside S256', () => {
        const errors = bySeverity({ code_challenge_methods_supported: ['S256', 'plain'] }, 'ERROR').map(
            (v) => v.message,
        )

        expect(errors.some((m) => m.includes('includes `plain`'))).toBe(true)
        // S256 is present, so that specific requirement should not also be flagged as missing.
        expect(errors.some((m) => m.includes('does not include `S256`'))).toBe(false)
    })

    it('is silent on the S256/plain rules when the field is entirely absent (already covered by the REQUIRED check)', () => {
        const errors = bySeverity({}, 'ERROR').map((v) => v.message)

        expect(errors.filter((m) => m.includes('S256') || m.includes('plain'))).toEqual([])
    })
})

describe('validateSmartConfiguration — grant_types_supported', () => {
    it('warns when authorization_code is missing', () => {
        const warnings = bySeverity({ grant_types_supported: ['client_credentials'] }, 'WARNING').map(
            (v) => v.message,
        )

        expect(warnings.some((m) => m.includes('authorization_code'))).toBe(true)
    })

    it('does not warn when authorization_code is present', () => {
        const warnings = bySeverity({ grant_types_supported: ['authorization_code'] }, 'WARNING').map(
            (v) => v.message,
        )

        expect(warnings.some((m) => m.includes('authorization_code'))).toBe(false)
    })
})

describe('validateSmartConfiguration — absolute URL requirement', () => {
    it('errors on a relative endpoint URL and mentions RFC 3986 resolution and the exchange id', () => {
        const errors = bySeverity({ token_endpoint: '/auth/token' }, 'ERROR').map((v) => v.message)
        const relevant = errors.find((m) => m.includes('token_endpoint'))

        expect(relevant).toBeDefined()
        expect(relevant).toContain('RFC 3986')
        expect(relevant).toContain(EXCHANGE_ID)
    })

    it('does not error when the endpoint URL is absolute', () => {
        const errors = bySeverity({ token_endpoint: 'https://ehr.example.com/token' }, 'ERROR').map(
            (v) => v.message,
        )

        expect(errors.some((m) => m.includes('relative URL'))).toBe(false)
    })
})

describe('validateSmartConfiguration — hostile input', () => {
    it('treats capabilities given as a string instead of an array as missing', () => {
        const config = { capabilities: 'launch-ehr' } as unknown as SmartConfiguration

        const errors = bySeverity(config, 'ERROR').map((v) => v.message)
        expect(errors.some((m) => m.includes('`capabilities`'))).toBe(true)
        // Since capabilities could not be read as an array, the conditional launch-ehr
        // requirement cannot be evaluated and must not be spuriously triggered.
        expect(errors.some((m) => m.includes('`authorization_endpoint`'))).toBe(false)
    })

    it('treats null field values as missing rather than throwing', () => {
        const config = {
            token_endpoint: null,
            grant_types_supported: null,
            capabilities: null,
        } as unknown as SmartConfiguration

        expect(() => validateSmartConfiguration(config, EXCHANGE_ID)).not.toThrow()
        const errors = bySeverity(config, 'ERROR').map((v) => v.message)
        expect(errors.some((m) => m.includes('`token_endpoint`'))).toBe(true)
    })

    it('treats an empty-string endpoint as missing rather than an invalid relative URL', () => {
        const errors = bySeverity({ token_endpoint: '' }, 'ERROR').map((v) => v.message)

        expect(errors.some((m) => m.includes('`token_endpoint`') && m.includes('missing'))).toBe(true)
        expect(errors.some((m) => m.includes('relative URL'))).toBe(false)
    })

    it('does not throw for a completely empty configuration object', () => {
        expect(() => validateSmartConfiguration({}, EXCHANGE_ID)).not.toThrow()
    })
})
