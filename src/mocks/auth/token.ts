import { randomUUID } from 'node:crypto'

import type { Context } from 'hono'
import { SignJWT } from 'jose'

import { computeCodeChallenge } from '#core/smart/pkce'
import type { MockState, RegisteredClient } from '#mocks/state'

import { identifyClient } from './verify-client'

/** https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html */
const ID_TOKEN_LIFETIME_SECONDS = 60 * 60
const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60

function oauthError(status: 400 | 401, error: string, description: string): Response {
    return new Response(JSON.stringify({ error, error_description: description }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

async function parseFormBody(c: Context): Promise<Record<string, string>> {
    const text = await c.req.text()
    return Object.fromEntries(new URLSearchParams(text))
}

async function signIdToken(state: MockState, client: RegisteredClient, fhirUser: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const audience = state.defects.has('id-token-wrong-audience') ? `not-${client.clientId}` : client.clientId
    const expiresAt = state.defects.has('id-token-expired') ? now - 60 : now + ID_TOKEN_LIFETIME_SECONDS

    const claims: Record<string, unknown> = state.defects.has('id-token-missing-fhir-user')
        ? {}
        : { fhirUser }

    return await new SignJWT(claims)
        .setProtectedHeader({ alg: state.signing.alg, kid: state.signing.kid })
        .setSubject(fhirUser)
        .setIssuer(state.baseUrl)
        .setAudience(audience)
        .setIssuedAt(now)
        .setExpirationTime(expiresAt)
        .sign(state.signing.privateKey)
}

/** Requested scope narrowed by one entry, so a validator can prove it detects a granted scope smaller than requested. */
function narrowScope(requestedScope: string): string[] {
    const scopes = requestedScope.split(' ').filter(Boolean)
    return scopes.slice(0, -1)
}

async function issueTokenResponse(
    c: Context,
    state: MockState,
    client: RegisteredClient,
    requestedScope: string,
): Promise<Response> {
    const grantedScopes = state.defects.has('token-response-narrows-scopes')
        ? narrowScope(requestedScope)
        : requestedScope.split(' ').filter(Boolean)

    const patient = state.resources.Patient.values().next().value
    const encounter = state.resources.Encounter.values().next().value
    const practitioner = state.resources.Practitioner.values().next().value
    const fhirUser = `Practitioner/${practitioner?.id}`

    const accessToken = randomUUID()
    const expiresAt = Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000
    state.accessTokens.set(accessToken, {
        clientId: client.clientId,
        scope: grantedScopes,
        patient: patient?.id ?? '',
        encounter: encounter?.id ?? '',
        fhirUser,
        expiresAt,
    })

    const refreshToken = state.defects.has('no-refresh-token') ? undefined : randomUUID()
    if (refreshToken) {
        state.refreshTokens.set(refreshToken, {
            clientId: client.clientId,
            scope: grantedScopes,
            patient: patient?.id ?? '',
            encounter: encounter?.id ?? '',
            fhirUser,
        })
    }

    const body: Record<string, unknown> = {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
        ...(state.defects.has('token-response-missing-scope') ? {} : { scope: grantedScopes.join(' ') }),
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        ...(state.defects.has('token-response-missing-patient-context') ? {} : { patient: patient?.id }),
        ...(state.defects.has('token-response-missing-encounter-context')
            ? {}
            : { encounter: encounter?.id }),
        fhirUser,
        need_patient_banner: true,
    }

    if (!state.defects.has('no-sso-openid-connect')) {
        body.id_token = await signIdToken(state, client, fhirUser)
    }

    return c.json(body)
}

async function handleAuthorizationCodeGrant(
    c: Context,
    state: MockState,
    client: RegisteredClient,
    params: Record<string, string>,
): Promise<Response> {
    const code = params.code
    if (!code) return oauthError(400, 'invalid_request', 'Missing code')

    const record = state.authorizationCodes.get(code)
    if (!record || record.used) return oauthError(400, 'invalid_grant', 'Unknown or already-used code')
    if (record.clientId !== client.clientId) {
        return oauthError(400, 'invalid_grant', 'code was not issued to this client')
    }
    if (params.redirect_uri !== record.redirectUri) {
        return oauthError(400, 'invalid_grant', 'redirect_uri does not match the authorization request')
    }

    const verifier = params.code_verifier
    if (!verifier || computeCodeChallenge(verifier) !== record.codeChallenge) {
        return oauthError(400, 'invalid_grant', 'code_verifier does not match the code_challenge')
    }

    record.used = true
    return issueTokenResponse(c, state, client, record.scope)
}

async function handleRefreshTokenGrant(
    c: Context,
    state: MockState,
    client: RegisteredClient,
    params: Record<string, string>,
): Promise<Response> {
    const token = params.refresh_token
    if (!token) return oauthError(400, 'invalid_request', 'Missing refresh_token')

    const record = state.refreshTokens.get(token)
    if (!record || record.clientId !== client.clientId) {
        return oauthError(400, 'invalid_grant', 'Unknown refresh_token')
    }

    return issueTokenResponse(c, state, client, record.scope.join(' '))
}

export function tokenHandler(state: MockState) {
    return async (c: Context): Promise<Response> => {
        const params = await parseFormBody(c)

        const clientAuth = await identifyClient(state, params, c.req.header('Authorization'))
        if (!clientAuth.ok) return oauthError(401, clientAuth.error, clientAuth.description)

        switch (params.grant_type) {
            case 'authorization_code':
                return handleAuthorizationCodeGrant(c, state, clientAuth.client, params)
            case 'refresh_token':
                return handleRefreshTokenGrant(c, state, clientAuth.client, params)
            default:
                return oauthError(
                    400,
                    'unsupported_grant_type',
                    `Unsupported grant_type: ${params.grant_type}`,
                )
        }
    }
}
