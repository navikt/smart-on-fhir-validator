/**
 * Discovery of the `.well-known/smart-configuration` document.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html#using-well-known
 */

import * as z from 'zod'

import type { HttpExchange } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'

import type { SmartConfiguration, SmartError } from './types'

/**
 * Every field optional, unknown fields passed through: a non-conformant document must still
 * parse so the validator reports a finding instead of crashing. A field of the wrong type is
 * treated as absent and reported missing, which is the same failure a vendor must fix.
 */
const optionalString = () => z.string().optional().catch(undefined)
const optionalStringArray = () => z.array(z.string()).optional().catch(undefined)

/** A malformed `associated_endpoints` entry is dropped rather than reported as a bogus endpoint. */
const AssociatedEndpointSchema = z
    .looseObject({
        url: z.string(),
        capabilities: z.array(z.string()).catch([]),
    })
    .nullable()
    .catch(null)

const AssociatedEndpointsSchema = z
    .array(AssociatedEndpointSchema)
    .optional()
    .catch(undefined)
    .transform((items) => {
        const valid = items?.filter((item) => item !== null)
        return valid && valid.length > 0 ? valid : undefined
    })

const SmartConfigurationSchema = z.looseObject({
    issuer: optionalString(),
    jwks_uri: optionalString(),
    authorization_endpoint: optionalString(),
    grant_types_supported: optionalStringArray(),
    token_endpoint: optionalString(),
    token_endpoint_auth_methods_supported: optionalStringArray(),
    registration_endpoint: optionalString(),
    associated_endpoints: AssociatedEndpointsSchema,
    user_access_brand_bundle: optionalString(),
    user_access_brand_identifier: optionalString(),
    scopes_supported: optionalStringArray(),
    response_types_supported: optionalStringArray(),
    management_endpoint: optionalString(),
    introspection_endpoint: optionalString(),
    revocation_endpoint: optionalString(),
    capabilities: optionalStringArray(),
    code_challenge_methods_supported: optionalStringArray(),
})

/**
 * SMART overrides RFC 5785: `.well-known` is appended to the full FHIR base URL, path included
 * (`www.ehr.example.com/apis/fhir` -> `.../apis/fhir/.well-known/...`).
 */
export function buildWellKnownUrl(fhirBaseUrl: string): string {
    const base = fhirBaseUrl.endsWith('/') ? fhirBaseUrl.slice(0, -1) : fhirBaseUrl
    return `${base}/.well-known/smart-configuration`
}

/**
 * Resolves a relative endpoint URL against the FHIR base URL per RFC 3986 §5. The spec requires
 * absolute URLs; this leniency only keeps a non-conformant server reachable enough to report on.
 */
export function resolveEndpoint(value: string | undefined, fhirBaseUrl: string): string | undefined {
    if (value === undefined) return undefined

    try {
        return new URL(value, fhirBaseUrl).toString()
    } catch {
        return value
    }
}

/**
 * A body that is not a JSON object yields an empty configuration rather than a parse failure;
 * the non-JSON case is already surfaced as a `SmartError` by `fetchSmartConfiguration`.
 */
function parseLenient(raw: unknown): SmartConfiguration {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}

    const result = SmartConfigurationSchema.safeParse(raw)
    return result.success ? result.data : {}
}

export async function fetchSmartConfiguration(
    client: SmartHttpClient,
    fhirBaseUrl: string,
): Promise<{ config: SmartConfiguration; raw: unknown; exchange: HttpExchange } | SmartError> {
    const url = buildWellKnownUrl(fhirBaseUrl)
    const response = await client.get('discovery', url, { Accept: 'application/json' })

    if (!response.ok) {
        return {
            error: response.exchange.error
                ? 'Failed to reach the well-known SMART configuration endpoint'
                : `The well-known SMART configuration endpoint responded with HTTP ${response.status}`,
            detail: response.exchange.error ?? undefined,
            exchangeId: response.exchange.id,
        }
    }

    // `null` means an empty body and a string means the body did not parse as JSON (or was a bare
    // JSON string), so neither is the JSON document this endpoint must return.
    if (response.body === null || typeof response.body === 'string') {
        return {
            error: 'The well-known SMART configuration endpoint did not return a JSON document',
            exchangeId: response.exchange.id,
        }
    }

    return { config: parseLenient(response.body), raw: response.body, exchange: response.exchange }
}
