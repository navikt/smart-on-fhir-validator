import type { ReactElement } from 'react'

import type { HttpExchange } from '#core/http/exchange'

import { JsonBlock } from '#components/json/JsonBlock'

import { HeadersTable } from './HeadersTable'

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

function RequestBody({ body }: { body: string }): ReactElement {
    const parsed = tryParseJson(body)
    if (parsed !== undefined) return <JsonBlock value={parsed} />

    return (
        <pre className="overflow-x-auto rounded bg-neutral-50 p-2 text-xs break-all whitespace-pre-wrap">
            {body}
        </pre>
    )
}

function ResponseBody({ body }: { body: unknown }): ReactElement {
    if (body === null) return <p className="text-xs text-neutral-500 italic">Empty body</p>
    if (typeof body === 'string') {
        return (
            <pre className="overflow-x-auto rounded bg-neutral-50 p-2 text-xs break-all whitespace-pre-wrap">
                {body}
            </pre>
        )
    }

    return <JsonBlock value={body} />
}

/**
 * The raw evidence behind a finding: the exact request this app sent and the exact response the
 * EHR returned, verbatim (already redacted at recording time — see `#core/http/redact`). Uses a
 * native `<details>`/`<summary>` for the expand/collapse interaction rather than client-side
 * state: it needs no JavaScript, works with assistive tech for free, and every value here is
 * already JSON-serialisable, so nothing about it requires a client component.
 */
export function ExchangePanel({ exchange }: { exchange: HttpExchange }): ReactElement {
    return (
        <details className="rounded border border-neutral-300">
            <summary className="cursor-pointer bg-neutral-50 px-3 py-2 text-sm font-medium select-none">
                Evidence: <span className="font-mono">{exchange.request.method}</span>{' '}
                <span className="font-mono break-all">{exchange.request.url}</span>
                {exchange.response && <> → HTTP {exchange.response.status}</>}
                {exchange.error && <> → transport error</>}
            </summary>
            <div className="space-y-4 border-t border-neutral-200 p-3">
                <section aria-label="Request">
                    <h4 className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                        Request
                    </h4>
                    <p className="mb-2 font-mono text-xs break-all">
                        {exchange.request.method} {exchange.request.url}
                    </p>
                    <HeadersTable headers={exchange.request.headers} />
                    {exchange.request.body !== undefined && (
                        <div className="mt-2">
                            <RequestBody body={exchange.request.body} />
                        </div>
                    )}
                </section>

                <section aria-label="Response">
                    <h4 className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                        Response
                    </h4>
                    {exchange.response ? (
                        <>
                            <p className="mb-2 font-mono text-xs">
                                HTTP {exchange.response.status} {exchange.response.statusText}
                            </p>
                            <HeadersTable headers={exchange.response.headers} />
                            <div className="mt-2">
                                <ResponseBody body={exchange.response.body} />
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-red-800">
                            No response was received: <span className="font-mono">{exchange.error}</span>
                        </p>
                    )}
                </section>

                <p className="text-xs text-neutral-500">
                    Started {exchange.startedAt} · took {exchange.durationMs}ms
                </p>
            </div>
        </details>
    )
}
