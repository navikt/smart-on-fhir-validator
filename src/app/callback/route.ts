import { NextResponse, type NextRequest } from 'next/server'

import { findIssuerConfig } from '#core/config/issuers'
import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { readSessionIdFromCookies } from '#core/session/session-cookie'
import { handleCallback } from '#core/smart/callback'
import { selectClientAuthentication } from '#core/smart/client-auth'
import { fetchSmartConfiguration } from '#core/smart/discovery'
import { isSmartError } from '#core/smart/types'
import { createSessionStore } from '#core/storage/session-store'
import { runValidation } from '#core/run'

import { getAppOrigin } from '../app-origin'
import { getReportStore } from '../report/report-store'

export const runtime = 'nodejs'

/**
 * Must agree with `../launch/route.ts`'s `callbackUrl` and with wherever the session cookie was
 * scoped, or this redirect (or the `redirect_uri` re-derived for the token exchange) lands on a
 * different host than the one the cookie is valid for.
 */
async function errorRedirect(error: string, detail?: string): Promise<NextResponse> {
    const url = new URL('/callback/error', await getAppOrigin())
    url.searchParams.set('error', error)
    if (detail) url.searchParams.set('detail', detail)

    return NextResponse.redirect(url)
}

/**
 * The SMART EHR launch callback: the authorization server redirects the browser here with
 * `?code=&state=` (or `?error=`) after the user approves the launch. Exchanges the code for a
 * token, then immediately runs every validator this app has (`runValidation`) against that real,
 * live session — exactly once, since the read/write probes write data to the EHR and must never
 * be re-run just because a vendor reloads `/report`. The resulting report is persisted keyed by
 * the session cookie, and the browser is redirected on to `/report` to read it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
    const sessionId = await readSessionIdFromCookies()
    if (!sessionId) {
        return errorRedirect(
            'session_not_found',
            'No pending session was found for this browser. Please restart the launch from your EHR.',
        )
    }

    const params = request.nextUrl.searchParams
    const recorder = createExchangeRecorder()
    const httpClient = new SmartHttpClient({ recorder })
    const sessionStore = await createSessionStore()

    const callbackResult = await handleCallback(
        {
            sessionId,
            code: params.get('code') ?? undefined,
            state: params.get('state') ?? undefined,
            error: params.get('error') ?? undefined,
            error_description: params.get('error_description') ?? undefined,
        },
        {
            httpClient,
            recorder,
            sessionStore,
            fetchSmartConfiguration,
            findIssuerConfig,
            selectClientAuthentication,
            redirectUri: new URL('/callback', await getAppOrigin()).toString(),
        },
    )

    if (isSmartError(callbackResult)) {
        return errorRedirect(callbackResult.error, callbackResult.detail)
    }

    const report = await runValidation(callbackResult, { httpClient, recorder })
    await getReportStore().set(sessionId, report)

    return NextResponse.redirect(new URL('/report', await getAppOrigin()))
}
