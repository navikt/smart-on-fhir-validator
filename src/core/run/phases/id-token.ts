/**
 * Phase 4: verifies the `id_token` signature against a freshly fetched JWKS, so a rotated or
 * revoked key is caught. Skipped rather than failed when the id_token is absent or the SMART
 * configuration lacks the `issuer`/`jwks_uri` needed to attempt verification.
 */

import type { ExchangeRecorder } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'
import { verifyIdToken, type IdTokenVerificationResult } from '#core/smart/id-token'
import type { ActiveSession, SmartConfiguration } from '#core/smart/types'
import { parseScopeString } from '#validation/smart/scopes'
import { validateIdToken } from '#validation/smart/id-token'

import { findLastExchangeId } from '../exchange-lookup'
import { buildSection, skippedSection, type ReportSection } from '../report'

function identityClaimRequested(requestedScope: string): boolean {
    const scopes = parseScopeString(requestedScope).map((scope) => scope.raw)
    return scopes.includes('openid') && (scopes.includes('fhirUser') || scopes.includes('profile'))
}

export async function runIdTokenPhase(
    session: ActiveSession,
    smartConfiguration: SmartConfiguration,
    http: SmartHttpClient,
    recorder: ExchangeRecorder,
): Promise<ReportSection> {
    const idToken = session.tokenResponse.id_token
    if (!idToken) {
        return skippedSection({
            id: 'id-token',
            title: 'ID Token',
            category: 'smart',
            reason: 'The token response did not include an id_token.',
        })
    }

    let verification: IdTokenVerificationResult | null = null
    let verificationSkippedReason: string | undefined

    if (smartConfiguration.issuer && smartConfiguration.jwks_uri) {
        verification = await verifyIdToken(idToken, {
            issuer: smartConfiguration.issuer,
            clientId: session.clientId,
            jwksUri: smartConfiguration.jwks_uri,
            httpClient: http,
        })
    } else {
        verificationSkippedReason =
            'SMART configuration did not advertise both `issuer` and `jwks_uri`, so the id_token ' +
            'signature could not be verified'
    }

    const validations = validateIdToken({
        idToken,
        verification,
        verificationSkippedReason,
        identityClaimRequested: identityClaimRequested(session.requestedScope),
        // This app does not currently send an OIDC `nonce` with the authorization request (see
        // `#core/smart/launch`), so there is nothing to compare the id_token's claim against.
        sentNonce: undefined,
    })

    return buildSection({
        id: 'id-token',
        title: 'ID Token',
        category: 'smart',
        exchangeId: findLastExchangeId(recorder.all(), 'jwks'),
        validations,
    })
}
