/**
 * The mock EHR issues real access tokens and signs `id_token`s, so it must never be reachable —
 * or advertised on the landing page — in production unless an operator explicitly opts in.
 * Mirrors the check in `src/app/api/mocks/fhir/[[...path]]/route.ts`.
 */
export function isMockEhrEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' || process.env.ENABLE_MOCK_EHR === 'true'
}
