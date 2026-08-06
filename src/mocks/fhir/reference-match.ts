/**
 * FHIR search values for reference parameters may be a full `Type/id` or a bare `id`. Real
 * servers accept both, so the mock does too rather than being needlessly stricter than the
 * thing it's meant to validate against.
 */
export function referenceMatches(reference: string | undefined, searchValue: string): boolean {
    if (!reference) return false
    if (reference === searchValue) return true

    // A bare id (no "Type/" prefix) matches the id segment of the resource's reference.
    return !searchValue.includes('/') && reference.endsWith(`/${searchValue}`)
}
