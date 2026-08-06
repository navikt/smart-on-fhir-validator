import { getPublicJwks } from '#core/smart/jwks'

export const dynamic = 'force-dynamic'

/**
 * The public half of this app's signing key, for EHRs that register it with
 * `client-confidential-asymmetric`. Registering a `jwks_uri` rather than an inline
 * `jwks` is what lets a vendor keep working across a key rotation.
 */
export async function GET(): Promise<Response> {
    return Response.json(await getPublicJwks(), {
        headers: { 'Cache-Control': 'public, max-age=300' },
    })
}
