import { NextResponse, type NextRequest } from 'next/server'

import { findIssuerConfig } from '#core/config/issuers'
import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { createSessionId, writeSessionCookie } from '#core/session/session-cookie'
import { fetchSmartConfiguration, resolveEndpoint } from '#core/smart/discovery'
import { handleLaunch } from '#core/smart/launch'
import { createOauthState, createPkcePair } from '#core/smart/pkce'
import { registerClient } from '#core/smart/registration'
import { isSmartError } from '#core/smart/types'
import { createSessionStore } from '#core/storage/session-store'

import { getAppOrigin } from '../app-origin'
import { APP_CLIENT_NAME, APP_SCOPE, STANDALONE_LAUNCH_PLACEHOLDER } from './config'

export const runtime = 'nodejs'

/**
 * `request.nextUrl.origin` is not usable here: the standalone/production server derives it from
 * the process's own bind address (`HOSTNAME`/`PORT`), not from the request the browser actually
 * sent, so it silently ignores `x-forwarded-host` behind nais's ingress. `getAppOrigin` reads the
 * proxy headers directly (mirroring `isRequestSecure` in `#core/session/session-cookie`) and is
 * the one thing here that must agree with where the session cookie itself was scoped, or the
 * redirect back from the authorization server lands on a host the cookie was never sent to.
 */
async function callbackUrl(): Promise<string> {
    return new URL('/callback', await getAppOrigin()).toString()
}

async function errorRedirect(error: string, detail?: string): Promise<NextResponse> {
    const url = new URL('/launch/error', await getAppOrigin())
    url.searchParams.set('error', error)
    if (detail) url.searchParams.set('detail', detail)

    return NextResponse.redirect(url)
}

/**
 * The SMART EHR launch endpoint: an EHR (or the standalone-launch form on `/`) navigates the
 * browser here with `?iss=<FHIR base URL>&launch=<opaque launch id>`. Discovers the issuer,
 * resolves or dynamically registers a client, persists a `PendingSession`, and redirects the
 * browser on to the authorization server. All the actual work lives in `#core/smart/launch`;
 * this handler only wires it to Next.js request/response and the session cookie.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
    const iss = request.nextUrl.searchParams.get('iss')
    const launch = request.nextUrl.searchParams.get('launch')

    if (!iss) {
        return errorRedirect('missing_iss', 'The iss query parameter is required to start a launch.')
    }

    const recorder = createExchangeRecorder()
    const httpClient = new SmartHttpClient({ recorder })
    const sessionStore = await createSessionStore()

    const result = await handleLaunch(
        { iss, launch: launch ?? STANDALONE_LAUNCH_PLACEHOLDER },
        {
            httpClient,
            recorder,
            sessionStore,
            fetchSmartConfiguration,
            resolveEndpoint,
            findIssuerConfig,
            registerClient,
            createPkcePair,
            createOauthState,
            createSessionId,
            redirectUri: await callbackUrl(),
            scope: APP_SCOPE,
            clientName: APP_CLIENT_NAME,
        },
    )

    if (isSmartError(result)) {
        return errorRedirect(result.error, result.detail)
    }

    await writeSessionCookie(result.sessionId)

    return NextResponse.redirect(result.redirectUrl)
}
