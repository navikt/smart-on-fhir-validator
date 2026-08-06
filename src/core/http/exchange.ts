/**
 * A validator's output is only as trustworthy as the evidence behind it. Every HTTP call the
 * app makes against an EHR is therefore recorded as an `HttpExchange` and shown alongside the
 * findings it produced, so a vendor can reproduce any result with `curl`.
 *
 * Exchanges are rendered in the browser and may be pasted into support tickets, so credentials
 * are stripped before the record is ever stored. See `redact.ts`.
 */

export type ExchangePhase =
    | 'discovery'
    | 'registration'
    | 'authorization'
    | 'token'
    | 'jwks'
    | 'capability'
    | 'fhir-read'
    | 'fhir-write'

export type HttpExchange = {
    /** Stable id, used to link a validation finding back to the call that produced it. */
    id: string
    phase: ExchangePhase
    request: {
        method: string
        url: string
        headers: Record<string, string>
        /** Present for form posts and FHIR writes. Already redacted. */
        body?: string
    }
    response: {
        status: number
        statusText: string
        headers: Record<string, string>
        /** Parsed JSON when the body was JSON, raw text otherwise, `null` when empty. */
        body: unknown
    } | null
    /** Set when the request never produced a response (DNS failure, TLS error, timeout). */
    error: string | null
    startedAt: string
    durationMs: number
}

export type ExchangeRecorder = {
    record: (exchange: HttpExchange) => void
    all: () => readonly HttpExchange[]
}

export function createExchangeRecorder(initial: readonly HttpExchange[] = []): ExchangeRecorder {
    const exchanges: HttpExchange[] = [...initial]

    return {
        record: (exchange) => {
            exchanges.push(exchange)
        },
        all: () => exchanges,
    }
}
