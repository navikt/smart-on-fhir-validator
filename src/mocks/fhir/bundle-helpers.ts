import type { Bundle, FhirResource } from 'fhir/r4'

/** `application/fhir+json` per the FHIR spec, not plain `application/json`. */
export function fhirJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/fhir+json', ...headers },
    })
}

export function toSearchBundle<T extends FhirResource>(
    baseUrl: string,
    resourceType: string,
    resources: readonly T[],
): Bundle<T> {
    return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: resources.length,
        entry: resources.map((resource) => ({
            fullUrl: `${baseUrl}/${resourceType}/${resource.id}`,
            resource,
            search: { mode: 'match' },
        })),
    }
}
