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

const RAW_PRE_CLASSES =
    'text-13 overflow-x-auto rounded-[3px] border border-ax-border-neutral-subtleA bg-ax-bg-neutral-soft p-3 leading-[1.6] whitespace-pre'

function RequestBody({ body }: { body: string }): ReactElement {
    const parsed = tryParseJson(body)
    if (parsed !== undefined) return <JsonBlock value={parsed} />

    return <pre className={RAW_PRE_CLASSES}>{body}</pre>
}

function ResponseBody({ body }: { body: unknown }): ReactElement {
    if (body === null) return <p className="text-13 text-ax-text-neutral-subtle italic">Empty body</p>
    if (typeof body === 'string') return <pre className={RAW_PRE_CLASSES}>{body}</pre>

    return <JsonBlock value={body} />
}

function statusColorClass(status: number): string {
    if (status >= 200 && status < 300) return 'text-ax-text-success'
    if (status >= 400) return 'text-ax-text-danger'

    return 'text-ax-text-neutral'
}

/**
 * The raw evidence behind a finding: the exact request this app sent and the exact response the
 * EHR returned, verbatim (already redacted at recording time — see `#core/http/redact`).
 */
export function ExchangePanel({ exchange }: { exchange: HttpExchange }): ReactElement {
    return (
        <details className="rounded border border-ax-border-neutral-subtle bg-ax-bg-neutral-soft">
            <summary className="text-15 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 font-semibold [&::-webkit-details-marker]:hidden">
                <span>Evidence, HTTP request and response</span>
                <span className="text-13 font-mono font-normal whitespace-nowrap">
                    {exchange.durationMs} ms
                </span>
            </summary>
            <div className="flex flex-col gap-3.5 border-t border-ax-border-neutral-subtle bg-white p-3.5">
                <section aria-label="Request">
                    <h4 className="text-12 tracking-eyebrow text-ax-text-neutral-subtle mb-1 font-bold uppercase">
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
                    <h4 className="text-12 tracking-eyebrow text-ax-text-neutral-subtle mb-1 font-bold uppercase">
                        Response
                        {exchange.response && (
                            <span
                                className={`ml-2 normal-case ${statusColorClass(exchange.response.status)}`}
                            >
                                HTTP {exchange.response.status} {exchange.response.statusText}
                            </span>
                        )}
                    </h4>
                    {exchange.response ? (
                        <>
                            <HeadersTable headers={exchange.response.headers} />
                            <div className="mt-2">
                                <ResponseBody body={exchange.response.body} />
                            </div>
                        </>
                    ) : (
                        <p className="text-14 text-ax-text-danger">
                            No response was received: <span className="font-mono">{exchange.error}</span>
                        </p>
                    )}
                </section>
            </div>
        </details>
    )
}
