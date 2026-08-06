/**
 * Which requirement a spec citation belongs to, for the at-a-glance "SMART requires" / "FHIR R4
 * requires" / "Nav requires" distinction. `RefTypes` (`#validation/common-refs`) does not carry
 * this as a field, so it is derived from the URL: the SMART App Launch IG and plain FHIR R4 both
 * publish under `hl7.org`/`build.fhir.org`, and only the SMART IG's path contains
 * `smart-app-launch`.
 */
export type RefKind = 'smart' | 'fhir' | 'nav' | 'profile'

export function classifyHl7Ref(url: string): 'smart' | 'fhir' {
    return url.includes('smart-app-launch') ? 'smart' : 'fhir'
}

export const REF_KIND_LABEL: Record<RefKind, string> = {
    smart: 'SMART requires',
    fhir: 'FHIR R4 requires',
    nav: 'Nav requires',
    profile: 'Norwegian FHIR profile',
}
