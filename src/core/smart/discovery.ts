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
 * Every field optional and unknown fields passed through: a non-conformant server's document
 * must still parse so the validation layer can report on exactly what was wrong, rather than
 * throwing before a finding can ever be produced. A field present with the wrong runtime type
 * is treated the same as an absent field via `.catch(undefined)` — the validator then reports
 * it missing, which is the same practical failure a vendor needs to fix.
 */
const optionalString = () => z.string().optional().catch(undefined)
const optionalStringArray = () => z.array(z.string()).optional().catch(undefined)

/**
 * `associated_endpoints` entries require both fields per `SmartConfiguration`. A malformed
 * entry (missing `url`, wrong type) is dropped from the array entirely via `.catch(null)` +
 * filter, rather than defaulting `url` to an empty string and producing a useless "endpoint".
 */
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
 * Appends the well-known path per RFC5785, which the spec explicitly overrides: the
 * `.well-known` segment is appended even when the FHIR base URL already has a path
 * component (e.g. `www.ehr.example.com/apis/fhir` -> `.../apis/fhir/.well-known/...`).
 */
export function buildWellKnownUrl(fhirBaseUrl: string): string {
    const base = fhirBaseUrl.endsWith('/') ? fhirBaseUrl.slice(0, -1) : fhirBaseUrl
    return `${base}/.well-known/smart-configuration`
}

/**
 * Resolves a (possibly relative) endpoint URL against the FHIR base URL, per RFC 3986 §5, for
 * legacy servers that return relative endpoint URLs. The spec requires absolute URLs, so this
 * is a courtesy for otherwise non-conformant servers rather than something to rely on.
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
 * Lenient parse of the well-known document body. Anything other than a JSON object (an array,
 * a primitive, or a body that failed to parse as JSON at all) is treated as an empty
 * configuration rather than a parse failure — the caller only needs to know the endpoint
 * responded with *something* other than a JSON document, and that is already surfaced via the
 * "non-JSON body" `SmartError` in `fetchSmartConfiguration`.
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

    // `parseBody` on the client only produces a string when the body is empty or failed to
    // parse as JSON — a JSON object, array, or primitive body already comes through as such.
    if (response.body === null || typeof response.body === 'string') {
        return {
            error: 'The well-known SMART configuration endpoint did not return a JSON document',
            exchangeId: response.exchange.id,
        }
    }

    return { config: parseLenient(response.body), raw: response.body, exchange: response.exchange }
}
