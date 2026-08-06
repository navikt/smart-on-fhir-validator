/**
 * SMART v1/v2 clinical scope matching: `<compartment>/<resource>.<interaction>`, e.g.
 * `patient/Patient.read` (v1) or `patient/Patient.rs` (v2 CRUDS letters). `*` is a wildcard for
 * both resource and interaction segments in both scope versions.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html
 */

export type FhirInteraction = 'read' | 'write'

type ParsedScope = {
    compartment: string
    resource: string
    interaction: string
}

function parseScope(scope: string): ParsedScope | null {
    const match = /^(patient|user|system)\/([A-Za-z*]+)\.([A-Za-z*]+)$/.exec(scope)
    if (!match) return null

    const [, compartment, resource, interaction] = match
    if (!compartment || !resource || !interaction) return null

    return { compartment, resource, interaction }
}

function interactionMatches(granted: string, wanted: FhirInteraction): boolean {
    if (granted === '*') return true
    if (wanted === 'read') return granted === 'read' || granted.includes('r') || granted.includes('s')
    return granted === 'write' || granted.includes('c') || granted.includes('u') || granted.includes('d')
}

/** Whether any of the granted scopes authorizes `interaction` on `resourceType`. */
export function scopeGrants(
    grantedScopes: readonly string[],
    resourceType: string,
    interaction: FhirInteraction,
): boolean {
    return grantedScopes.some((scope) => {
        const parsed = parseScope(scope)
        if (!parsed) return false

        const resourceMatches = parsed.resource === '*' || parsed.resource === resourceType
        return resourceMatches && interactionMatches(parsed.interaction, interaction)
    })
}
