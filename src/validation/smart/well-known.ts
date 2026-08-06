/**
 * Validation of the `.well-known/smart-configuration` document against the SMART App Launch
 * conformance rules.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html#metadata
 */

import type { SmartConfiguration } from '#core/smart/types'
import type { RefTypes } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Severity, type Validation } from '#validation/validation'

const conformanceUrl = 'https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html'

const refs = {
    metadata: { hl7: `${conformanceUrl}#metadata` },
    usingWellKnown: { hl7: `${conformanceUrl}#using-well-known` },
} satisfies Record<string, RefTypes>

type FieldKind = 'string' | 'array'

type FieldSpec = {
    field: keyof SmartConfiguration
    kind: FieldKind
    label: string
    /** Only checked when true — used for the CONDITIONAL requirements. */
    when?: (config: SmartConfiguration) => boolean
    /** Explains a conditional requirement in the finding message. */
    reason?: string
}

function hasCapability(config: SmartConfiguration, capability: string): boolean {
    return Array.isArray(config.capabilities) && config.capabilities.includes(capability)
}

const REQUIRED: FieldSpec[] = [
    { field: 'grant_types_supported', kind: 'array', label: '`grant_types_supported`' },
    { field: 'token_endpoint', kind: 'string', label: '`token_endpoint`' },
    { field: 'capabilities', kind: 'array', label: '`capabilities`' },
    { field: 'code_challenge_methods_supported', kind: 'array', label: '`code_challenge_methods_supported`' },
]

const CONDITIONAL: FieldSpec[] = [
    {
        field: 'issuer',
        kind: 'string',
        label: '`issuer`',
        when: (config) => hasCapability(config, 'sso-openid-connect'),
        reason: 'the server advertises the `sso-openid-connect` capability',
    },
    {
        field: 'jwks_uri',
        kind: 'string',
        label: '`jwks_uri`',
        when: (config) => hasCapability(config, 'sso-openid-connect'),
        reason: 'the server advertises the `sso-openid-connect` capability',
    },
    {
        field: 'authorization_endpoint',
        kind: 'string',
        label: '`authorization_endpoint`',
        when: (config) => hasCapability(config, 'launch-ehr') || hasCapability(config, 'launch-standalone'),
        reason: 'the server advertises `launch-ehr` or `launch-standalone`',
    },
]

const RECOMMENDED: FieldSpec[] = [
    { field: 'scopes_supported', kind: 'array', label: '`scopes_supported`' },
    { field: 'response_types_supported', kind: 'array', label: '`response_types_supported`' },
    { field: 'management_endpoint', kind: 'string', label: '`management_endpoint`' },
    { field: 'introspection_endpoint', kind: 'string', label: '`introspection_endpoint`' },
    { field: 'revocation_endpoint', kind: 'string', label: '`revocation_endpoint`' },
    { field: 'user_access_brand_bundle', kind: 'string', label: '`user_access_brand_bundle`' },
    { field: 'user_access_brand_identifier', kind: 'string', label: '`user_access_brand_identifier`' },
]

const OPTIONAL: FieldSpec[] = [
    {
        field: 'token_endpoint_auth_methods_supported',
        kind: 'array',
        label: '`token_endpoint_auth_methods_supported`',
    },
    { field: 'registration_endpoint', kind: 'string', label: '`registration_endpoint`' },
    { field: 'associated_endpoints', kind: 'array', label: '`associated_endpoints`' },
]

/** Endpoint fields the spec requires to be absolute URLs. */
const ENDPOINT_FIELDS: (keyof SmartConfiguration)[] = [
    'issuer',
    'jwks_uri',
    'authorization_endpoint',
    'token_endpoint',
    'registration_endpoint',
    'management_endpoint',
    'introspection_endpoint',
    'revocation_endpoint',
]

function isValidField(value: unknown, kind: FieldKind): boolean {
    if (kind === 'array') return Array.isArray(value) && value.length > 0
    return typeof value === 'string' && value.trim().length > 0
}

function isAbsoluteUrl(value: string): boolean {
    try {
        return Boolean(new URL(value))
    } catch {
        return false
    }
}

function evaluateGroup(
    config: SmartConfiguration,
    specs: FieldSpec[],
    severity: Severity,
    validator: Validator,
    okValidations: Validation[],
) {
    for (const spec of specs) {
        if (spec.when && !spec.when(config)) continue

        const value = config[spec.field]
        if (isValidField(value, spec.kind)) {
            okValidations.push(validation(`${spec.label} is present, as required`, 'OK', refs.metadata))
            continue
        }

        const suffix = spec.reason ? `, required because ${spec.reason}` : ''
        const message = `${spec.label} is missing from the well-known SMART configuration document${suffix}`
        if (severity === 'ERROR') validator.error(message, refs.metadata)
        else if (severity === 'WARNING') validator.warn(message, refs.metadata)
        else validator.info(message, refs.metadata)
    }
}

function evaluateCodeChallengeMethods(config: SmartConfiguration, validator: Validator, ok: Validation[]) {
    const methods = Array.isArray(config.code_challenge_methods_supported)
        ? config.code_challenge_methods_supported
        : []
    if (methods.length === 0) return

    if (methods.includes('S256')) {
        ok.push(
            validation(
                '`code_challenge_methods_supported` includes `S256`, as required',
                'OK',
                refs.metadata,
            ),
        )
    } else {
        validator.error(
            '`code_challenge_methods_supported` does not include `S256`, which SHALL be supported',
            refs.metadata,
        )
    }

    if (methods.includes('plain')) {
        validator.error(
            '`code_challenge_methods_supported` includes `plain`, which SHALL NOT be supported',
            refs.metadata,
        )
    } else {
        ok.push(
            validation('`code_challenge_methods_supported` correctly excludes `plain`', 'OK', refs.metadata),
        )
    }
}

function evaluateGrantTypes(config: SmartConfiguration, validator: Validator, ok: Validation[]) {
    const grantTypes = Array.isArray(config.grant_types_supported) ? config.grant_types_supported : []
    if (grantTypes.length === 0) return

    if (grantTypes.includes('authorization_code')) {
        ok.push(validation('`grant_types_supported` includes `authorization_code`', 'OK', refs.metadata))
    } else {
        validator.warn(
            '`grant_types_supported` does not include `authorization_code`, which SMART App Launch requires',
            refs.metadata,
        )
    }
}

function evaluateAbsoluteUrls(
    config: SmartConfiguration,
    exchangeId: string,
    validator: Validator,
    ok: Validation[],
) {
    for (const field of ENDPOINT_FIELDS) {
        const value = config[field]
        if (typeof value !== 'string' || value.length === 0) continue

        if (isAbsoluteUrl(value)) {
            ok.push(validation(`\`${field}\` is an absolute URL, as required`, 'OK', refs.usingWellKnown))
            continue
        }

        validator.error(
            `\`${field}\` ("${value}") is a relative URL; the spec requires absolute URLs. This app ` +
                `resolves it against the FHIR base URL per RFC1808, but the server should be fixed ` +
                `(see HTTP exchange ${exchangeId})`,
            refs.usingWellKnown,
        )
    }
}

export function validateSmartConfiguration(config: SmartConfiguration, exchangeId: string): Validation[] {
    const validator = new Validator()
    const okValidations: Validation[] = []

    evaluateGroup(config, REQUIRED, 'ERROR', validator, okValidations)
    evaluateGroup(config, CONDITIONAL, 'ERROR', validator, okValidations)
    evaluateGroup(config, RECOMMENDED, 'WARNING', validator, okValidations)
    evaluateGroup(config, OPTIONAL, 'INFO', validator, okValidations)

    evaluateCodeChallengeMethods(config, validator, okValidations)
    evaluateGrantTypes(config, validator, okValidations)
    evaluateAbsoluteUrls(config, exchangeId, validator, okValidations)

    return [...validator.build(), ...okValidations]
}
