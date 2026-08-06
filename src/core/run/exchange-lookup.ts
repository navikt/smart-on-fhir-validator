import type { ExchangePhase, HttpExchange } from '#core/http/exchange'

/**
 * The most recent recorded exchange for `phase`, or `null` when none was recorded. Used to
 * attribute a phase's findings to the HTTP call that produced the evidence, e.g. token-response
 * findings to the token endpoint call made during `/callback` rather than the run itself.
 */
export function findLastExchangeId(exchanges: readonly HttpExchange[], phase: ExchangePhase): string | null {
    let found: string | null = null
    for (const exchange of exchanges) {
        if (exchange.phase === phase) found = exchange.id
    }

    return found
}
