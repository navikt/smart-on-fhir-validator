import type { ExchangePhase, HttpExchange } from '#core/http/exchange'

/**
 * The most recent recorded exchange for `phase`, or `null` when none was recorded. Attributes a
 * phase's findings to the call that produced the evidence — token-response findings belong to
 * the token call made during `/callback`, not to the run itself.
 */
export function findLastExchangeId(exchanges: readonly HttpExchange[], phase: ExchangePhase): string | null {
    let found: string | null = null
    for (const exchange of exchanges) {
        if (exchange.phase === phase) found = exchange.id
    }

    return found
}
