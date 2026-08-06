/**
 * Phase 3: validates the access token response persisted on the session during `/callback`.
 * Purely a re-interpretation of already-collected evidence — no new HTTP call.
 */

import type { ActiveSession } from '#core/smart/types'
import { validateTokenResponse } from '#validation/smart/token-response'

import { findLastExchangeId } from '../exchange-lookup'
import { buildSection, type ReportSection } from '../report'

export function runTokenResponsePhase(session: ActiveSession): ReportSection {
    const exchangeId = findLastExchangeId(session.exchanges, 'token')

    return buildSection({
        id: 'token-response',
        title: 'Token Response',
        category: 'smart',
        exchangeId,
        validations: validateTokenResponse(
            session.tokenResponse,
            session.requestedScope,
            exchangeId ?? 'unknown',
        ),
    })
}
