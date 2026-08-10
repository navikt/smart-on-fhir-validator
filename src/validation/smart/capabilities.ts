/**
 * Validation of SMART "Capabilities" and "Capability Sets".
 *
 * @see https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html#capabilities
 * @see https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html#capability-sets
 */

import type { SmartCapability, SmartConfiguration } from '#core/smart/types'
import type { RefTypes, SpecRef } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

const conformanceUrl = 'https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html'

const refs = {
    capabilities: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Capabilities',
        href: `${conformanceUrl}#capabilities`,
    },
    permissions: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Permissions',
        href: `${conformanceUrl}#permissions`,
    },
    clientTypes: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Client Types',
        href: `${conformanceUrl}#client-types`,
    },
} satisfies Record<string, SpecRef>

/** The finite set of strings the SMART App Launch spec defines itself. */
const KNOWN_CAPABILITIES: readonly SmartCapability[] = [
    'launch-ehr',
    'launch-standalone',
    'authorize-post',
    'client-public',
    'client-confidential-symmetric',
    'client-confidential-asymmetric',
    'sso-openid-connect',
    'context-banner',
    'context-style',
    'context-ehr-patient',
    'context-ehr-encounter',
    'context-standalone-patient',
    'context-standalone-encounter',
    'permission-offline',
    'permission-online',
    'permission-patient',
    'permission-user',
    'permission-v1',
    'permission-v2',
]

const KNOWN_CAPABILITY_SET: ReadonlySet<string> = new Set(KNOWN_CAPABILITIES)

/**
 * Splits a server's advertised `capabilities` into ones this app recognizes from the SMART App
 * Launch spec and everything else. Non-string entries (a hostile/malformed array) and a
 * `capabilities` value that isn't an array at all are silently dropped here — that shape
 * problem is reported by `validateSmartConfiguration` in `well-known.ts`, which owns the
 * REQUIRED-field checks; this function only classifies whatever it can read.
 */
export function parseCapabilities(config: SmartConfiguration): {
    known: SmartCapability[]
    unknown: string[]
} {
    const raw = Array.isArray(config.capabilities) ? config.capabilities : []
    const known: SmartCapability[] = []
    const unknown: string[] = []

    for (const capability of raw) {
        if (typeof capability !== 'string') continue
        if (KNOWN_CAPABILITY_SET.has(capability)) known.push(capability as SmartCapability)
        else unknown.push(capability)
    }

    return { known, unknown }
}

function isAbsoluteUri(value: string): boolean {
    try {
        return Boolean(new URL(value))
    } catch {
        return false
    }
}

type CapabilitySet = {
    name: string
    required: SmartCapability[]
    anchor: string
    /** Nav's own use case: an EHR-launched clinician-facing app. Failing this is an ERROR. */
    isNavTarget: boolean
}

const CAPABILITY_SETS: CapabilitySet[] = [
    {
        name: 'Patient Access for Standalone Apps',
        required: ['launch-standalone', 'context-standalone-patient', 'permission-patient'],
        anchor: `${conformanceUrl}#patient-access-for-standalone-apps`,
        isNavTarget: false,
    },
    {
        name: 'Patient Access for EHR Launch',
        required: ['launch-ehr', 'context-ehr-patient', 'permission-patient'],
        anchor: `${conformanceUrl}#patient-access-for-ehr-launch-ie-from-portal`,
        isNavTarget: false,
    },
    {
        name: 'Clinician Access for Standalone',
        required: ['launch-standalone', 'permission-user', 'permission-patient'],
        anchor: `${conformanceUrl}#clinician-access-for-standalone`,
        isNavTarget: false,
    },
    {
        name: 'Clinician Access for EHR Launch',
        required: [
            'launch-ehr',
            'context-ehr-patient',
            'context-ehr-encounter',
            'permission-user',
            'permission-patient',
        ],
        anchor: `${conformanceUrl}#clinician-access-for-ehr-launch`,
        isNavTarget: true,
    },
]

/**
 * Every Capability Set additionally requires at least one of `client-public` or
 * `client-confidential-symmetric` (with `client-confidential-asymmetric` allowed in addition).
 * This is evaluated once rather than per set.
 */
function hasRequiredClientType(known: readonly SmartCapability[]): boolean {
    return known.includes('client-public') || known.includes('client-confidential-symmetric')
}

export function validateCapabilitySets(config: SmartConfiguration): Validation[] {
    const validator = new Validator()
    const ok: Validation[] = []
    const { known, unknown } = parseCapabilities(config)

    const hasClientType = hasRequiredClientType(known)
    if (hasClientType) {
        ok.push(
            validation(
                'Server supports at least one required client type (`client-public` or `client-confidential-symmetric`)',
                'OK',
                [refs.clientTypes],
            ),
        )
    } else {
        validator.error(
            'Server does not advertise `client-public` or `client-confidential-symmetric`; every SMART capability set requires at least one',
            [refs.clientTypes],
        )
    }

    for (const set of CAPABILITY_SETS) {
        const missing = set.required.filter((capability) => !known.includes(capability))
        const setRef: RefTypes = [
            { authority: 'smart', cite: `SMART App Launch 2.2 §${set.name}`, href: set.anchor },
        ]

        if (missing.length === 0 && hasClientType) {
            ok.push(
                validation(
                    `Server satisfies the "${set.name}" capability set${set.isNavTarget ? ' (Nav\u2019s use case)' : ''}`,
                    'OK',
                    setRef,
                ),
            )
            continue
        }

        const reasons = [
            ...missing.map((capability) => `\`${capability}\` not advertised`),
            ...(hasClientType ? [] : ['no supported client type']),
        ]
        const message = `Server does not satisfy the "${set.name}" capability set (${reasons.join(', ')})`

        if (set.isNavTarget) validator.error(message, setRef)
        else validator.info(message, setRef)
    }

    if (known.includes('permission-v2')) {
        ok.push(
            validation(
                'Server supports `permission-v2` (SMARTv2 granular scope syntax), as Nav requires',
                'OK',
                [refs.permissions],
            ),
        )
    } else {
        validator.warn(
            'Server does not advertise `permission-v2`; Nav requires support for SMARTv2 granular scope syntax',
            [refs.permissions],
        )
    }

    if (known.includes('permission-v1')) {
        ok.push(
            validation('Server supports `permission-v1` (SMARTv1 scope syntax)', 'OK', [refs.permissions]),
        )
    } else {
        validator.info('Server does not advertise `permission-v1` (SMARTv1 scope syntax)', [refs.permissions])
    }

    const nonUriUnknown = unknown.filter((capability) => !isAbsoluteUri(capability))
    if (nonUriUnknown.length > 0) {
        validator.warn(
            `Server advertises unrecognized capabilities as simple strings (${nonUriUnknown.join(', ')}); ` +
                'the SMART spec reserves simple, non-URI strings for capabilities it defines itself. ' +
                'Third-party implementation guides SHALL use full URIs',
            [refs.capabilities],
        )
    }

    const uriUnknown = unknown.filter(isAbsoluteUri)
    if (uriUnknown.length > 0) {
        validator.info(
            `Server advertises additional capabilities via URIs, presumably from a third-party implementation guide: ${uriUnknown.join(', ')}`,
            [refs.capabilities],
        )
    }

    return [...validator.build(), ...ok]
}
