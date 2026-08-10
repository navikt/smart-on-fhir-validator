/**
 * Phase 2: fetches the FHIR `CapabilityStatement` (`GET /metadata`) purely to confirm the FHIR
 * version the server implements. SMART configuration itself always comes from the well-known
 * document (`discovery.ts`) — this endpoint is otherwise deprecated for that purpose.
 */

import type { SmartHttpClient } from '#core/http/smart-http-client'
import {
    classifyFhirVersion,
    detectFhirVersion,
    fetchCapabilityStatement,
} from '#core/smart/capability-statement'
import type { ActiveSession } from '#core/smart/types'
import { isSmartError } from '#core/smart/types'
import type { RefTypes } from '#validation/common-refs'
import { validation, type Validation } from '#validation/validation'

import { buildSection, errorSection, type ReportSection } from '../report'

/** No dedicated ref exists in `#validation/common-refs` for FHIR's version families. */
const FHIR_VERSION_REF: RefTypes = [
    {
        authority: 'fhir',
        cite: 'FHIR §Publication (Version) History',
        href: 'https://hl7.org/fhir/directory.html',
    },
]

function fhirVersionFindings(capabilityStatement: unknown): Validation[] {
    const version = detectFhirVersion(capabilityStatement)
    if (version === null) {
        return [
            validation(
                'The FHIR CapabilityStatement (`GET /metadata`) does not declare a `fhirVersion`.',
                'ERROR',
                FHIR_VERSION_REF,
            ),
        ]
    }

    const versionClass = classifyFhirVersion(version)
    if (versionClass === 'R4') {
        return [
            validation(
                `The server declares FHIR version \`${version}\` (R4), as Nav requires.`,
                'OK',
                FHIR_VERSION_REF,
            ),
        ]
    }

    return [
        validation(
            `The server declares FHIR version \`${version}\` (${versionClass}), not R4. Nav requires R4.`,
            'ERROR',
            FHIR_VERSION_REF,
        ),
    ]
}

export async function runCapabilityStatementPhase(
    session: ActiveSession,
    http: SmartHttpClient,
): Promise<ReportSection> {
    const result = await fetchCapabilityStatement(http, session.fhirBaseUrl)

    if (isSmartError(result)) {
        return errorSection({
            id: 'capability-statement',
            title: 'FHIR Capability Statement',
            category: 'fhir-conformance',
            error: result,
        })
    }

    return buildSection({
        id: 'capability-statement',
        title: 'FHIR Capability Statement',
        category: 'fhir-conformance',
        exchangeId: result.exchange.id,
        validations: fhirVersionFindings(result.capabilityStatement),
    })
}
