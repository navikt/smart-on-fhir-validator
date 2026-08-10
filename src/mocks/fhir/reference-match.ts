/**
 * FHIR search values for reference parameters may be a full `Type/id` or a bare `id`. Real
 * servers accept both, so the mock does too rather than being stricter than the thing it is
 * meant to validate against.
 */
export function referenceMatches(reference: string | undefined, searchValue: string): boolean {
    if (!reference) return false
    if (reference === searchValue) return true

    return !searchValue.includes('/') && reference.endsWith(`/${searchValue}`)
}
