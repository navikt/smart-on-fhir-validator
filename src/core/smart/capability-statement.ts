/**
 * Fetching and classifying the FHIR `CapabilityStatement`, used only to detect the FHIR
 * version the server implements — SMART configuration itself comes from the well-known
 * document (see `discovery.ts`); the CapabilityStatement mechanism for that is deprecated.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html#using-well-known
 */

import type { HttpExchange } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'

import type { SmartError } from './types'

export async function fetchCapabilityStatement(
    client: SmartHttpClient,
    fhirBaseUrl: string,
): Promise<{ capabilityStatement: unknown; exchange: HttpExchange } | SmartError> {
    const base = fhirBaseUrl.endsWith('/') ? fhirBaseUrl.slice(0, -1) : fhirBaseUrl
    const response = await client.get('capability', `${base}/metadata`, { Accept: 'application/fhir+json' })

    if (!response.ok) {
        return {
            error: response.exchange.error
                ? 'Failed to reach the FHIR CapabilityStatement endpoint'
                : `The FHIR CapabilityStatement endpoint responded with HTTP ${response.status}`,
            detail: response.exchange.error ?? undefined,
            exchangeId: response.exchange.id,
        }
    }

    if (response.body === null || typeof response.body === 'string') {
        return {
            error: 'The FHIR CapabilityStatement endpoint did not return a JSON document',
            exchangeId: response.exchange.id,
        }
    }

    return { capabilityStatement: response.body, exchange: response.exchange }
}

export function detectFhirVersion(capabilityStatement: unknown): string | null {
    if (typeof capabilityStatement !== 'object' || capabilityStatement === null) return null

    const version = (capabilityStatement as Record<string, unknown>).fhirVersion
    return typeof version === 'string' && version.length > 0 ? version : null
}

export type FhirVersionClass = 'R4' | 'R4B' | 'R5' | 'DSTU2' | 'STU3' | 'unknown'

/**
 * Classifies by major.minor prefix rather than exact patch match, since patch releases within
 * a family (e.g. `4.0.0` and `4.0.1`) are both R4.
 *
 * @see https://hl7.org/fhir/directory.html
 */
export function classifyFhirVersion(version: string | null): FhirVersionClass {
    if (!version) return 'unknown'
    if (version.startsWith('4.0')) return 'R4'
    if (version.startsWith('4.3')) return 'R4B'
    if (version.startsWith('5.0')) return 'R5'
    if (version.startsWith('3.0')) return 'STU3'
    if (version.startsWith('1.0')) return 'DSTU2'
    return 'unknown'
}

/** R4 is the `4.0.x` family; `4.3.0` is the distinct R4B family and must not be reported as R4. */
export function isR4(version: string | null): boolean {
    return classifyFhirVersion(version) === 'R4'
}
