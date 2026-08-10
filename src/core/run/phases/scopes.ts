/** Phase 5: compares requested vs granted scopes. No new HTTP call. */

import type { ActiveSession, SmartConfiguration } from '#core/smart/types'
import { validateScopes } from '#validation/smart/scopes'

import { findLastExchangeId } from '../exchange-lookup'
import { buildSection, type ReportSection } from '../report'

export function runScopesPhase(
    session: ActiveSession,
    smartConfiguration: SmartConfiguration,
): ReportSection {
    return buildSection({
        id: 'scopes',
        title: 'Scopes',
        category: 'smart',
        exchangeId: findLastExchangeId(session.exchanges, 'token'),
        validations: validateScopes({
            requestedScope: session.requestedScope,
            grantedScope: session.tokenResponse.scope,
            smartConfiguration,
        }),
    })
}
