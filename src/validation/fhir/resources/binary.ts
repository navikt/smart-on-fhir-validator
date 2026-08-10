import type { Binary } from 'fhir/r4'

import { fullRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

export type BinaryExpectations = {
    id?: string | null
    contentType?: string | null
    /** Set when the payload included a securityContext reference (not required by Nav). */
    securityContext?: string | null
}

/**
 * Validates a Binary against FHIR R4 (https://hl7.org/fhir/R4/binary.html). Nav does not mandate
 * `securityContext`; it is checked only when the probe sent one, to confirm the EHR round-trips it.
 */
export function validateBinary(binary: Binary | null, expectations: BinaryExpectations = {}): Validation[] {
    const validator = new Validator()
    const ok: Validation[] = []

    if (binary == null) {
        validator.error('No Binary resource was returned to validate', fullRefs.binary)
        return validator.build()
    }

    if (binary.resourceType !== 'Binary') {
        validator.error(`Resource is not of type Binary, was "${binary.resourceType}"`, fullRefs.binary)
    }

    if (expectations.id != null) {
        if (binary.id === expectations.id) {
            ok.push(validation(`Binary.id matches the id the probe wrote ("${expectations.id}")`, 'OK'))
        } else {
            validator.error(
                `Binary.id was not the same as the id the probe wrote, was "${binary.id ?? 'missing'}", expected "${expectations.id}"`,
                fullRefs.binary,
            )
        }
    }

    if (!binary.contentType) {
        validator.error('Binary.contentType is missing. It is a required field in FHIR R4.', fullRefs.binary)
    } else if (expectations.contentType != null && binary.contentType !== expectations.contentType) {
        validator.error(
            `Binary.contentType ("${binary.contentType}") does not match what was written ("${expectations.contentType}"). The server may have re-encoded or dropped the original content type.`,
            fullRefs.binary,
        )
    } else {
        ok.push(validation(`Binary.contentType is correctly "${binary.contentType}"`, 'OK'))
    }

    if (!binary.data) {
        validator.warn(
            'Binary.data is empty when read back as FHIR+JSON. Some servers only serve the raw bytes back under the original Content-Type instead of inlining base64 data on a JSON read; if so, the raw-body form should be checked separately.',
            fullRefs.binary,
        )
    } else {
        ok.push(validation('Binary.data contains the base64-encoded payload', 'OK'))
    }

    if (expectations.securityContext != null) {
        if (binary.securityContext?.reference !== expectations.securityContext) {
            validator.warn(
                `Binary.securityContext was not round-tripped, expected a reference to "${expectations.securityContext}", was "${binary.securityContext?.reference ?? 'missing'}". Nav's docs do not require securityContext, but if a server drops it, that should be surfaced.`,
                fullRefs.binary,
            )
        } else {
            ok.push(validation('Binary.securityContext was correctly round-tripped', 'OK'))
        }
    }

    return [...validator.build(), ...ok]
}
