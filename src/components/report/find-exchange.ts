import type { HttpExchange } from '#core/http/exchange'

export function findExchange(
    exchanges: readonly HttpExchange[],
    exchangeId: string | null,
): HttpExchange | null {
    if (exchangeId === null) return null

    return exchanges.find((exchange) => exchange.id === exchangeId) ?? null
}
