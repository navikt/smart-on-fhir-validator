import { randomUUID } from 'node:crypto'

import type { ExchangePhase, ExchangeRecorder, HttpExchange } from './exchange'
import { DEBUG_REDACTION, REPORT_REDACTION, redactBody, redactHeaders, redactJson, redactUrl } from './redact'

export type RecordedResponse = {
    exchange: HttpExchange
    status: number
    ok: boolean
    /** Unredacted body. Only for use by the auth layer; never store this on an exchange. */
    body: unknown
    headers: Headers
    /** True when `maxResponseBytes` cut the body short; `body` is then `TRUNCATED_BODY_MARKER`, never a prefix. */
    bodyTruncated: boolean
}

export type SmartHttpClientOptions = {
    recorder: ExchangeRecorder
    fetchImpl?: typeof fetch
    timeoutMs?: number
    /** Streamed bodies are read up to this many bytes, then the stream is cancelled. Unbounded when unset. */
    maxResponseBytes?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

/** A truncated prefix cannot be parsed, so nested secrets could not be redacted: it is never kept. */
export const TRUNCATED_BODY_MARKER = '[TRUNCATED: response body exceeded the capture limit and was discarded]'

/**
 * The single outbound HTTP path of the application: no code path can reach an EHR without
 * leaving evidence in the report. Non-2xx responses and transport failures are returned rather
 * than thrown: a malformed or failing server is the subject under test, not an exception.
 */
export class SmartHttpClient {
    private readonly recorder: ExchangeRecorder
    private readonly fetchImpl: typeof fetch
    private readonly timeoutMs: number
    private readonly maxResponseBytes: number | undefined

    constructor({
        recorder,
        fetchImpl = fetch,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxResponseBytes,
    }: SmartHttpClientOptions) {
        if (
            maxResponseBytes !== undefined &&
            !(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes >= 0)
        ) {
            throw new RangeError(`maxResponseBytes must be a non-negative integer, got ${maxResponseBytes}`)
        }
        this.recorder = recorder
        this.fetchImpl = fetchImpl
        this.timeoutMs = timeoutMs
        this.maxResponseBytes = maxResponseBytes
    }

    async send(
        phase: ExchangePhase,
        url: string,
        init: RequestInit & { headers?: Record<string, string> } = {},
    ): Promise<RecordedResponse> {
        const sets = phase === 'debug' ? DEBUG_REDACTION : REPORT_REDACTION
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
                url: redactUrl(url, sets),
                headers: redactHeaders(requestHeaders),
                ...(rawRequestBody === undefined
                    ? {}
                    : { body: redactBody(rawRequestBody, contentType, sets) }),
            },
            startedAt: startedAt.toISOString(),
        }

        try {
            const response = await this.fetchImpl(url, {
                ...init,
                signal: AbortSignal.timeout(this.timeoutMs),
            })
            const { body, truncated } = await parseBody(response, this.maxResponseBytes)

            const exchange: HttpExchange = {
                ...base,
                response: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: redactHeaders(response.headers),
                    body: redactJson(body, sets),
                },
                error: null,
                durationMs: Math.round(performance.now() - start),
            }
            this.recorder.record(exchange)

            return {
                exchange,
                status: response.status,
                ok: response.ok,
                body,
                headers: response.headers,
                bodyTruncated: truncated,
            }
        } catch (cause) {
            const exchange: HttpExchange = {
                ...base,
                response: null,
                error: describeTransportError(cause),
                durationMs: Math.round(performance.now() - start),
            }
            this.recorder.record(exchange)

            return {
                exchange,
                status: 0,
                ok: false,
                body: null,
                headers: new Headers(),
                bodyTruncated: false,
            }
        }
    }

    get(
        phase: ExchangePhase,
        url: string,
        headers: Record<string, string> = {},
        redirect?: RequestInit['redirect'],
    ): Promise<RecordedResponse> {
        return this.send(phase, url, {
            method: 'GET',
            headers,
            ...(redirect === undefined ? {} : { redirect }),
        })
    }

    postForm(
        phase: ExchangePhase,
        url: string,
        form: Record<string, string>,
        headers: Record<string, string> = {},
        redirect?: RequestInit['redirect'],
    ): Promise<RecordedResponse> {
        return this.send(phase, url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...headers,
            },
            body: new URLSearchParams(form).toString(),
            ...(redirect === undefined ? {} : { redirect }),
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

function describeTransportError(error: unknown): string {
    if (!(error instanceof Error)) return String(error)
    if (!(error.cause instanceof Error)) return error.message

    const code = 'code' in error.cause && typeof error.cause.code === 'string' ? error.cause.code : null
    const causeMessage = error.cause.message
    const reason =
        code && !causeMessage.includes(code) ? [code, causeMessage].filter(Boolean).join(': ') : causeMessage

    return reason ? `${error.message} (${reason})` : error.message
}

async function parseBody(
    response: Response,
    maxBytes: number | undefined,
): Promise<{ body: unknown; truncated: boolean }> {
    const { text, truncated } =
        maxBytes === undefined ? await readAll(response) : await readBounded(response, maxBytes)
    if (text.length === 0) return { body: null, truncated }
    if (truncated) return { body: TRUNCATED_BODY_MARKER, truncated }

    try {
        return { body: JSON.parse(text), truncated }
    } catch {
        return { body: text, truncated }
    }
}

async function readAll(response: Response): Promise<{ text: string; truncated: boolean }> {
    return { text: await response.text(), truncated: false }
}

async function readBounded(
    response: Response,
    maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
    if (!response.body) return { text: '', truncated: false }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    let truncated = false

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const remaining = maxBytes - received
        if (value.byteLength > remaining) {
            chunks.push(value.subarray(0, remaining))
            received = maxBytes
            truncated = true
            await reader.cancel()
            break
        }

        chunks.push(value)
        received += value.byteLength
    }

    const merged = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
    }

    return { text: new TextDecoder().decode(merged), truncated }
}
