import { randomUUID } from 'node:crypto'

import type { ExchangePhase, ExchangeRecorder, HttpExchange } from './exchange'
import { redactBody, redactHeaders, redactJson, redactUrl } from './redact'

export type RecordedResponse = {
    exchange: HttpExchange
    status: number
    ok: boolean
    /** Unredacted body. Only for use by the auth layer; never store this on an exchange. */
    body: unknown
    headers: Headers
}

export type SmartHttpClientOptions = {
    recorder: ExchangeRecorder
    /** Injectable for tests. Defaults to global fetch. */
    fetchImpl?: typeof fetch
    timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * The single outbound HTTP path of the application.
 *
 * Every call is recorded, so no code path can reach an EHR without leaving evidence in the
 * report. Non-2xx responses and transport failures are returned rather than thrown: a
 * malformed or failing server is the subject under test, not an exception.
 */
export class SmartHttpClient {
    private readonly recorder: ExchangeRecorder
    private readonly fetchImpl: typeof fetch
    private readonly timeoutMs: number

    constructor({ recorder, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: SmartHttpClientOptions) {
        this.recorder = recorder
        this.fetchImpl = fetchImpl
        this.timeoutMs = timeoutMs
    }

    async send(
        phase: ExchangePhase,
        url: string,
        init: RequestInit & { headers?: Record<string, string> } = {},
    ): Promise<RecordedResponse> {
        const startedAt = new Date()
        const start = performance.now()
        const method = init.method ?? 'GET'
        const requestHeaders = init.headers ?? {}
        const contentType = requestHeaders['Content-Type'] ?? requestHeaders['content-type'] ?? null
        const rawRequestBody = typeof init.body === 'string' ? init.body : undefined

        const base = {
            id: randomUUID(),
            phase,
            request: {
                method,
                url: redactUrl(url),
                headers: redactHeaders(requestHeaders),
                ...(rawRequestBody === undefined ? {} : { body: redactBody(rawRequestBody, contentType) }),
            },
            startedAt: startedAt.toISOString(),
        }

        try {
            const response = await this.fetchImpl(url, {
                ...init,
                signal: AbortSignal.timeout(this.timeoutMs),
            })
            const body = await parseBody(response)

            const exchange: HttpExchange = {
                ...base,
                response: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: redactHeaders(response.headers),
                    body: redactJson(body),
                },
                error: null,
                durationMs: Math.round(performance.now() - start),
            }
            this.recorder.record(exchange)

            return { exchange, status: response.status, ok: response.ok, body, headers: response.headers }
        } catch (cause) {
            const exchange: HttpExchange = {
                ...base,
                response: null,
                error: cause instanceof Error ? cause.message : String(cause),
                durationMs: Math.round(performance.now() - start),
            }
            this.recorder.record(exchange)

            return { exchange, status: 0, ok: false, body: null, headers: new Headers() }
        }
    }

    get(phase: ExchangePhase, url: string, headers: Record<string, string> = {}): Promise<RecordedResponse> {
        return this.send(phase, url, { method: 'GET', headers })
    }

    postForm(
        phase: ExchangePhase,
        url: string,
        form: Record<string, string>,
        headers: Record<string, string> = {},
    ): Promise<RecordedResponse> {
        return this.send(phase, url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
            body: new URLSearchParams(form).toString(),
        })
    }

    postJson(
        phase: ExchangePhase,
        url: string,
        payload: unknown,
        headers: Record<string, string> = {},
    ): Promise<RecordedResponse> {
        return this.send(phase, url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(payload),
        })
    }
}

async function parseBody(response: Response): Promise<unknown> {
    const text = await response.text()
    if (text.length === 0) return null

    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}
