import { randomUUID } from 'node:crypto'

import type { Context } from 'hono'

import type { MockState } from '#mocks/state'

/**
 * https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html#step-3-app-exchanges-authorization-code-for-access-token
 *
 * Validates the authorization request and issues a code. `aud` MUST equal this server's FHIR
 * base URL: a common client bug is sending the issuer instead. Skippable via the
 * `aud-not-validated` defect.
 */
export function authorizeHandler(state: MockState) {
    return (c: Context): Response => {
        const query = c.req.query()
        const redirectUri = query.redirect_uri
        if (!redirectUri) {
            return c.text('Missing required parameter: redirect_uri', 400)
        }

        const clientId = query.client_id
        if (!clientId) {
            return c.text('Missing required parameter: client_id', 400)
        }

        const client = state.clients.get(clientId)
        if (!client) {
            return c.text('Unknown client_id', 400)
        }

        if (client.redirectUris && !client.redirectUris.includes(redirectUri)) {
            return c.text('redirect_uri is not registered for this client', 400)
        }

        const errorRedirect = (error: string, description: string): Response => {
            const url = new URL(redirectUri)
            url.searchParams.set('error', error)
            url.searchParams.set('error_description', description)
            if (query.state) url.searchParams.set('state', query.state)

            return c.redirect(url.toString(), 302)
        }

        if (query.response_type !== 'code') {
            return errorRedirect('unsupported_response_type', 'Only response_type=code is supported')
        }

        for (const required of ['scope', 'state', 'aud', 'code_challenge', 'code_challenge_method']) {
            if (!query[required]) {
                return errorRedirect('invalid_request', `Missing required parameter: ${required}`)
            }
        }

        const scope = query.scope!
        const oauthState = query.state!
        const aud = query.aud!
        const codeChallenge = query.code_challenge!
        const codeChallengeMethod = query.code_challenge_method!

        if (aud !== state.baseUrl && !state.defects.has('aud-not-validated')) {
            return errorRedirect(
                'invalid_request',
                `aud must equal the FHIR base URL "${state.baseUrl}", was "${aud}"`,
            )
        }

        if (codeChallengeMethod !== 'S256') {
            return errorRedirect('invalid_request', 'Only code_challenge_method=S256 is supported')
        }

        const code = randomUUID()
        state.authorizationCodes.set(code, {
            clientId,
            redirectUri,
            scope,
            codeChallenge,
            codeChallengeMethod,
            used: false,
        })

        const redirectUrl = new URL(redirectUri)
        redirectUrl.searchParams.set('code', code)
        redirectUrl.searchParams.set('state', oauthState)

        return c.redirect(redirectUrl.toString(), 302)
    }
}
