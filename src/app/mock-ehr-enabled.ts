/**
 * Mirrors the enablement check in `src/app/api/mocks/fhir/[[...path]]/route.ts` (not owned by
 * this module, so the one-line rule is duplicated rather than imported): the mock EHR issues real
 * access tokens and signs `id_token`s, so it must never be reachable — and never advertised on the
 * landing page — in a production deployment unless an operator has explicitly opted in.
 */
export function isMockEhrEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' || process.env.ENABLE_MOCK_EHR === 'true'
}
