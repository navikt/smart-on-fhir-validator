/**
 * Validation of the access token response returned by the token endpoint during the
 * `authorization_code` exchange.
 *
 * @see https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html#response-5
 * @see https://www.rfc-editor.org/rfc/rfc6749#section-5.1
 * @see https://www.rfc-editor.org/rfc/rfc6749#section-5.2
 */

import type { SpecRef } from '#validation/common-refs'
import { navRefs } from '#validation/common-refs'
import { parseScopeString } from '#validation/smart/scopes'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

const appLaunchUrl = 'https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html'
const scopesUrl = 'https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html'
const rfc6749 = 'https://www.rfc-editor.org/rfc/rfc6749'

const refs = {
    tokenResponse: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Token response',
        href: `${appLaunchUrl}#response-5`,
    },
    errorResponse: {
        authority: 'oauth',
        cite: 'RFC 6749 §5.2 Error response',
        href: `${rfc6749}#section-5.2`,
    },
    accessTokenResponse: {
        authority: 'oauth',
        cite: 'RFC 6749 §5.1 Successful response',
        href: `${rfc6749}#section-5.1`,
    },
    launchContext: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Launch context arrives with your access_token',
        href: `${scopesUrl}#launch-context-arrives-with-your-access_token`,
    },
    identityToken: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Scopes for requesting identity data',
        href: `${scopesUrl}#scopes-for-requesting-identity-data`,
    },
    refreshScopes: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Scopes for requesting a refresh token',
        href: `${scopesUrl}#scopes-for-requesting-a-refresh-token`,
    },
    navEncounter: navRefs.smartGettingStarted,
} satisfies Record<string, SpecRef>

function readString(source: object, field: string): string | undefined {
    const value = (source as Record<string, unknown>)[field]
    return typeof value === 'string' ? value : undefined
}

function readValue(source: object, field: string): unknown {
    return (source as Record<string, unknown>)[field]
}

function hasRequestedScope(
    requestedScopes: ReturnType<typeof parseScopeString>,
    predicate: (raw: string) => boolean,
): boolean {
    return requestedScopes.some((scope) => predicate(scope.raw))
}

/**
 * Validates the raw body of a token endpoint response against RFC 6749 §5.1 and the SMART App
 * Launch response requirements. `raw` is genuinely `unknown`: a non-conformant server may return
 * anything, and reporting that is the point.
 */
export function validateTokenResponse(
    raw: unknown,
    requestedScope: string,
    exchangeId: string,
): Validation[] {
    const validator = new Validator()
    const ok: Validation[] = []

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        const shape = raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw
        validator.error(
            `The token endpoint response (exchange ${exchangeId}) is not a JSON object; got ` +
                `${shape}. RFC 6749 requires a JSON object body.`,
            [refs.accessTokenResponse],
        )
        return validator.build()
    }

    const body = raw as object

    // An OAuth error response (RFC 6749 §5.2) is mutually exclusive with a successful token
    // response, so surface it and stop — every other field check below would be noise.
    const errorCode = readString(body, 'error')
    if (errorCode !== undefined) {
        const description = readString(body, 'error_description')
        validator.error(
            `The token endpoint returned an OAuth error: \`${errorCode}\`` +
                (description ? `: ${description}` : ' (no error_description was given)') +
                `. See exchange ${exchangeId}.`,
            [refs.errorResponse],
        )
        return validator.build()
    }

    const requestedScopes = parseScopeString(requestedScope)
    const requestedOpenid = hasRequestedScope(requestedScopes, (token) => token === 'openid')
    const requestedIdentityClaim = hasRequestedScope(
        requestedScopes,
        (token) => token === 'fhirUser' || token === 'profile',
    )
    const requestedOffline = hasRequestedScope(requestedScopes, (token) => token === 'offline_access')
    const requestedOnline = hasRequestedScope(requestedScopes, (token) => token === 'online_access')
    const requestedLaunch = hasRequestedScope(requestedScopes, (token) => token === 'launch')
    const requestedLaunchPatient = hasRequestedScope(requestedScopes, (token) => token === 'launch/patient')

    validateAccessToken(body, validator, ok)
    validateTokenType(body, validator, ok)
    validateExpiresIn(body, validator, ok)
    validateScope(body, validator, ok)
    validateIdToken(body, requestedOpenid && requestedIdentityClaim, validator, ok)
    validateRefreshToken(body, requestedOffline || requestedOnline, validator, ok)
    validatePatient(body, requestedLaunch || requestedLaunchPatient, validator, ok)
    validateEncounter(body, requestedLaunch, validator, ok)
    reportOptionalFields(body, ok)

    return [...validator.build(), ...ok]
}

function validateAccessToken(body: object, validator: Validator, ok: Validation[]) {
    const value = readValue(body, 'access_token')
    if (typeof value === 'string' && value.length > 0) {
        ok.push(validation('`access_token` is present and non-empty', 'OK', [refs.accessTokenResponse]))
        return
    }

    validator.error(
        `\`access_token\` is ${value === undefined ? 'missing' : 'present but not a non-empty string'} from the ` +
            'token response; RFC 6749 §5.1 requires it.',
        [refs.accessTokenResponse],
    )
}

function validateTokenType(body: object, validator: Validator, ok: Validation[]) {
    const value = readValue(body, 'token_type')
    if (typeof value !== 'string' || value.length === 0) {
        validator.error(
            '`token_type` is missing from the token response; RFC 6749 §5.1 requires it (SMART requires ' +
                'the value `Bearer`).',
            [refs.accessTokenResponse],
        )
        return
    }

    if (value === 'Bearer') {
        ok.push(validation('`token_type` is exactly `Bearer`, as SMART requires', 'OK', [refs.tokenResponse]))
        return
    }

    if (value.toLowerCase() === 'bearer') {
        validator.warn(
            `\`token_type\` is \`${value}\`, not exactly \`Bearer\`. RFC 6749 says the value is ` +
                'case-insensitive, but SMART App Launch expects the literal string `Bearer`.',
            [refs.tokenResponse],
        )
        return
    }

    validator.error(
        `\`token_type\` is \`${value}\`, a different scheme than \`Bearer\` entirely. SMART App Launch ` +
            'requires `Bearer` tokens.',
        [refs.tokenResponse],
    )
}

function validateExpiresIn(body: object, validator: Validator, ok: Validation[]) {
    const value = readValue(body, 'expires_in')
    if (value === undefined) {
        validator.warn(
            '`expires_in` is absent from the token response. RFC 6749 §5.1 RECOMMENDS it, and SMART App ' +
                'Launch strongly recommends it so the app knows when to refresh.',
            [refs.accessTokenResponse],
        )
        return
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        validator.error(
            `\`expires_in\` is present but not a positive number (got ${JSON.stringify(value)}).`,
            [refs.accessTokenResponse],
        )
        return
    }

    ok.push(
        validation(`\`expires_in\` is present and a positive number (${value}s)`, 'OK', [
            refs.accessTokenResponse,
        ]),
    )
}

function validateScope(body: object, validator: Validator, ok: Validation[]) {
    const value = readValue(body, 'scope')
    if (typeof value === 'string' && value.length > 0) {
        ok.push(validation('`scope` (the granted scope string) is present', 'OK', [refs.tokenResponse]))
        return
    }

    validator.error(
        '`scope` is missing from the token response; without it the app cannot know what it is actually ' +
            'authorized to do, since a server may grant less than was requested.',
        [refs.tokenResponse],
    )
}

function validateIdToken(body: object, identityRequested: boolean, validator: Validator, ok: Validation[]) {
    const value = readValue(body, 'id_token')
    const present = typeof value === 'string' && value.length > 0

    if (present) {
        ok.push(
            validation('`id_token` is present, as required for identity scopes', 'OK', [refs.identityToken]),
        )
        return
    }

    if (identityRequested) {
        validator.error(
            '`id_token` is missing from the token response, even though `openid` plus `fhirUser` or ' +
                '`profile` were requested. Without it the app cannot identify the logged-in clinician.',
            [refs.identityToken],
        )
    }
}

function validateRefreshToken(
    body: object,
    refreshRequested: boolean,
    validator: Validator,
    ok: Validation[],
) {
    const value = readValue(body, 'refresh_token')
    const present = typeof value === 'string' && value.length > 0

    if (present) {
        ok.push(validation('`refresh_token` is present, as requested', 'OK', [refs.refreshScopes]))
        return
    }

    if (refreshRequested) {
        validator.warn(
            '`refresh_token` is missing from the token response, even though `offline_access` or ' +
                '`online_access` was requested.',
            [refs.refreshScopes],
        )
    }
}

function validatePatient(
    body: object,
    patientContextRequested: boolean,
    validator: Validator,
    ok: Validation[],
) {
    const value = readValue(body, 'patient')
    const present = typeof value === 'string' && value.length > 0

    if (present) {
        ok.push(
            validation('`patient` is present in the token response, enabling patient-context probes', 'OK', [
                refs.launchContext,
            ]),
        )
        return
    }

    if (patientContextRequested) {
        validator.error(
            '`patient` is missing from the token response, even though a `launch` or `launch/patient` ' +
                'scope was requested. Without it, no patient-context FHIR probe can be run.',
            [refs.launchContext],
        )
    }
}

function validateEncounter(
    body: object,
    ehrLaunchRequested: boolean,
    validator: Validator,
    ok: Validation[],
) {
    const value = readValue(body, 'encounter')
    const present = typeof value === 'string' && value.length > 0

    if (present) {
        ok.push(validation('`encounter` is present in the token response', 'OK', [refs.launchContext]))
        return
    }

    if (!ehrLaunchRequested) return

    // SMART does not universally require `encounter` on an EHR launch; this is a Nav requirement,
    // since the sykmelding pre-fill flow reads Encounter for kontakttype.
    validator.warn(
        '`encounter` is missing from the token response for an EHR launch (`launch` scope was requested). ' +
            'The SMART spec does not universally require this, but Nav requires an Encounter to be reachable ' +
            'from launch context for its sykmelding pre-fill flow.',
        [refs.launchContext, navRefs.smartGettingStarted],
    )
}

function reportOptionalFields(body: object, ok: Validation[]) {
    const optionalFields: { field: string; label: string }[] = [
        { field: 'need_patient_banner', label: '`need_patient_banner`' },
        { field: 'smart_style_url', label: '`smart_style_url`' },
        { field: 'intent', label: '`intent`' },
        { field: 'tenant', label: '`tenant`' },
    ]

    for (const { field, label } of optionalFields) {
        const value = readValue(body, field)
        if (value === undefined) continue

        ok.push(validation(`${label} is present: ${JSON.stringify(value)}`, 'INFO', [refs.tokenResponse]))
    }
}
