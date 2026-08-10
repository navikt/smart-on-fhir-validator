/**
 * Phase 1: re-fetches and validates `.well-known/smart-configuration`, and derives the SMART
 * Capabilities section from it. Re-fetched rather than reusing the session's copy, so the report
 * reflects the server's current configuration.
 */

import type { SmartHttpClient } from '#core/http/smart-http-client'
import { fetchSmartConfiguration } from '#core/smart/discovery'
import type { ActiveSession, SmartConfiguration } from '#core/smart/types'
import { isSmartError } from '#core/smart/types'
import { validateCapabilitySets } from '#validation/smart/capabilities'
import { validateSmartConfiguration } from '#validation/smart/well-known'

import { buildSection, errorSection, type ReportSection } from '../report'

export type DiscoveryPhaseResult = {
    sections: ReportSection[]
    /** The freshly-fetched configuration, or the session's stale copy when the re-fetch failed. */
    smartConfiguration: SmartConfiguration
}

export async function runDiscoveryPhase(
    session: ActiveSession,
    http: SmartHttpClient,
): Promise<DiscoveryPhaseResult> {
    const result = await fetchSmartConfiguration(http, session.fhirBaseUrl)

    if (isSmartError(result)) {
        const discoverySection = errorSection({
            id: 'discovery',
            title: 'SMART Discovery (.well-known/smart-configuration)',
            category: 'smart',
            error: result,
        })
        const capabilitiesSection = buildSection({
            id: 'capabilities',
            title: 'SMART Capabilities',
            category: 'smart',
            exchangeId: result.exchangeId ?? null,
            validations: validateCapabilitySets(session.smartConfiguration),
        })

        return {
            sections: [discoverySection, capabilitiesSection],
            smartConfiguration: session.smartConfiguration,
        }
    }

    const discoverySection = buildSection({
        id: 'discovery',
        title: 'SMART Discovery (.well-known/smart-configuration)',
        category: 'smart',
        exchangeId: result.exchange.id,
        validations: validateSmartConfiguration(result.config, result.exchange.id),
    })
    const capabilitiesSection = buildSection({
        id: 'capabilities',
        title: 'SMART Capabilities',
        category: 'smart',
        exchangeId: result.exchange.id,
        validations: validateCapabilitySets(result.config),
    })

    return { sections: [discoverySection, capabilitiesSection], smartConfiguration: result.config }
}
