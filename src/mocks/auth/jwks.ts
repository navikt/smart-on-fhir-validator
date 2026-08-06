import type { Context } from 'hono'

import type { MockState } from '#mocks/state'

/** The mock EHR's own public signing key(s), so a client can verify the `id_token` it issues. */
export function jwksHandler(state: MockState) {
    return (c: Context): Response => c.json(state.signing.jwks)
}
