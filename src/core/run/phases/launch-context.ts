/**
 * Phase 6: builds the `LaunchContext` the FHIR probes are allowed to use, from the token response
 * and id_token claims already on the session. No new HTTP call.
 */

import type { ActiveSession } from '#core/smart/types'
import type { LaunchContext } from '#core/smart/types'
import { buildLaunchContext } from '#validation/smart/launch-context'

import { findLastExchangeId } from '../exchange-lookup'
import { buildSection, type ReportSection } from '../report'

export type LaunchContextPhaseResult = {
    launchContext: LaunchContext
    section: ReportSection
}

export function runLaunchContextPhase(session: ActiveSession): LaunchContextPhaseResult {
    const { launchContext, validations } = buildLaunchContext(session.tokenResponse, session.idTokenClaims)

    const section = buildSection({
        id: 'launch-context',
        title: 'Launch Context',
        category: 'smart',
        exchangeId: findLastExchangeId(session.exchanges, 'token'),
        validations,
    })

    return { launchContext, section }
}
