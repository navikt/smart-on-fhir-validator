'use client'

import Link from 'next/link'
import { useId, useState, type FormEvent, type ReactElement } from 'react'

import type { DebugSessionView } from '#core/debug/session-view'
import { JSON_PATCH, FHIR_JSON } from '#core/debug/request'
import type { HttpExchange } from '#core/http/exchange'

import { HeadersTable } from '#components/exchange/HeadersTable'
import { JsonBlock } from '#components/json/JsonBlock'

import {
    allowsBody,
    allowsQuery,
    buildRequest,
    effectiveMethod,
    EMPTY_DRAFT,
    isWrite,
    METHOD_OPTIONS,
    type MethodOption,
    type RequestDraft,
} from './draft'
import { summarizeResponse } from './outcome'

type DebugResult =
    | { kind: 'exchange'; exchange: HttpExchange; bodyTruncated: boolean }
    | { kind: 'failure'; error: string; detail: string }

const FIELD_CLASSES =
    'text-16 min-h-11 rounded border border-ax-border-neutral bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-border-focus'

const LABEL_CLASSES = 'text-14 font-semibold text-ax-text-neutral-subtle'

const EYEBROW_CLASSES = 'text-13 font-bold tracking-eyebrow text-ax-text-neutral-subtle uppercase'

async function sendRequest(request: unknown): Promise<DebugResult> {
    let response: Response
    try {
        response = await fetch('/api/debug/fhir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            cache: 'no-store',
        })
    } catch (error) {
        return {
            kind: 'failure',
            error: 'network_error',
            detail: error instanceof Error ? error.message : 'The debug request could not be sent.',
        }
    }

    let payload: unknown
    try {
        payload = await response.json()
    } catch {
        return {
            kind: 'failure',
            error: 'unexpected_response',
            detail: `The server answered HTTP ${response.status} without a JSON body.`,
        }
    }

    const data = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>

    if (data.ok === true && typeof data.exchange === 'object' && data.exchange !== null) {
        return {
            kind: 'exchange',
            exchange: data.exchange as HttpExchange,
            bodyTruncated: data.bodyTruncated === true,
        }
    }

    return {
        kind: 'failure',
        error: typeof data.error === 'string' ? data.error : 'unexpected_response',
        detail:
            typeof data.detail === 'string' ? data.detail : `The server answered HTTP ${response.status}.`,
    }
}

function bodyAsText(body: unknown): string {
    if (body === null || body === undefined) return ''
    if (typeof body === 'string') return body

    return JSON.stringify(body, null, 2)
}

function WriteWarning(): ReactElement {
    return (
        <div
            role="note"
            className="text-16 rounded border border-l-8 border-ax-border-warning bg-ax-bg-warning-soft px-4 py-3 text-ax-text-warning"
        >
            <p className="font-bold">This changes the real EHR</p>
            <p className="mt-1 max-w-[70ch]">
                Requests other than GET and HEAD use your launch token and write to the connected FHIR server.
                Check the resource, id and body before sending.
            </p>
        </div>
    )
}

function ErrorNote({ title, detail }: { title: string; detail: string }): ReactElement {
    return (
        <div
            role="alert"
            className="text-16 rounded border border-l-8 border-ax-border-danger bg-ax-bg-danger-soft px-4 py-3 text-ax-text-danger"
        >
            <p className="font-bold">{title}</p>
            <p className="mt-1 max-w-[70ch] break-words">{detail}</p>
        </div>
    )
}

function RequestBuilder({
    draft,
    onChange,
    onSend,
    sending,
    resourceTypeOptions,
}: {
    draft: RequestDraft
    onChange: (next: RequestDraft) => void
    onSend: () => void
    sending: boolean
    resourceTypeOptions: readonly string[]
}): ReactElement {
    const ids = useId()
    const method = effectiveMethod(draft)
    const showQuery = allowsQuery(method)
    const showBody = allowsBody(method)
    const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]): void =>
        onChange({ ...draft, [key]: value })

    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        onSend()
    }

    return (
        <form
            onSubmit={submit}
            className="flex flex-col gap-4 rounded border border-ax-border-neutral-subtle bg-white px-5 py-[18px]"
        >
            <h2 className={EYEBROW_CLASSES}>Request</h2>

            <div className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-48 flex-1 flex-col gap-1">
                    <label htmlFor={`${ids}-type`} className={LABEL_CLASSES}>
                        Resource type
                    </label>
                    <input
                        id={`${ids}-type`}
                        name="resourceType"
                        value={draft.resourceType}
                        onChange={(event) => set('resourceType', event.target.value)}
                        list={`${ids}-types`}
                        placeholder="Patient"
                        autoComplete="off"
                        spellCheck={false}
                        className={`${FIELD_CLASSES} font-mono`}
                    />
                    <datalist id={`${ids}-types`}>
                        {resourceTypeOptions.map((option) => (
                            <option key={option} value={option} />
                        ))}
                    </datalist>
                </div>

                <span aria-hidden="true" className="text-20 pb-2 text-ax-text-neutral-subtle">
                    /
                </span>

                <div className="flex min-w-48 flex-1 flex-col gap-1">
                    <label htmlFor={`${ids}-id`} className={LABEL_CLASSES}>
                        Id (optional)
                    </label>
                    <input
                        id={`${ids}-id`}
                        name="id"
                        value={draft.id}
                        onChange={(event) => set('id', event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className={`${FIELD_CLASSES} font-mono`}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label htmlFor={`${ids}-method`} className={LABEL_CLASSES}>
                        Method
                    </label>
                    <select
                        id={`${ids}-method`}
                        name="method"
                        value={draft.method}
                        onChange={(event) => set('method', event.target.value as MethodOption)}
                        className={FIELD_CLASSES}
                    >
                        {METHOD_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                </div>

                {draft.method === 'Other' && (
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`${ids}-other`} className={LABEL_CLASSES}>
                            Custom method
                        </label>
                        <input
                            id={`${ids}-other`}
                            name="otherMethod"
                            value={draft.otherMethod}
                            onChange={(event) => set('otherMethod', event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            className={`${FIELD_CLASSES} w-36 font-mono uppercase`}
                        />
                    </div>
                )}
            </div>

            {showQuery && (
                <div className="flex flex-col gap-1">
                    <label htmlFor={`${ids}-query`} className={LABEL_CLASSES}>
                        Query (without the leading ?)
                    </label>
                    <input
                        id={`${ids}-query`}
                        name="query"
                        value={draft.query}
                        onChange={(event) => set('query', event.target.value)}
                        placeholder="_count=5&_sort=-date"
                        autoComplete="off"
                        spellCheck={false}
                        className={`${FIELD_CLASSES} font-mono`}
                    />
                </div>
            )}

            {showBody && (
                <div className="flex flex-col gap-3">
                    {method === 'PATCH' && (
                        <div className="flex flex-col gap-1">
                            <label htmlFor={`${ids}-ct`} className={LABEL_CLASSES}>
                                Content type
                            </label>
                            <select
                                id={`${ids}-ct`}
                                name="contentType"
                                value={draft.contentType}
                                onChange={(event) =>
                                    set('contentType', event.target.value as RequestDraft['contentType'])
                                }
                                className={`${FIELD_CLASSES} max-w-xs`}
                            >
                                <option value={FHIR_JSON}>FHIR JSON</option>
                                <option value={JSON_PATCH}>JSON Patch</option>
                            </select>
                        </div>
                    )}
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`${ids}-body`} className={LABEL_CLASSES}>
                            Body (JSON)
                        </label>
                        <textarea
                            id={`${ids}-body`}
                            name="body"
                            value={draft.body}
                            onChange={(event) => set('body', event.target.value)}
                            rows={8}
                            spellCheck={false}
                            className={`${FIELD_CLASSES} font-mono text-13`}
                        />
                    </div>
                </div>
            )}

            {isWrite(method) && <WriteWarning />}

            <div>
                <button
                    type="submit"
                    disabled={sending}
                    className="text-16 min-h-11 rounded bg-ax-bg-accent-strong px-6 font-semibold text-ax-text-contrast hover:bg-ax-bg-accent-strong-hover disabled:cursor-wait disabled:opacity-60"
                >
                    {sending ? 'Sending…' : 'Send'}
                </button>
            </div>
        </form>
    )
}

function ResponseView({
    exchange,
    bodyTruncated,
}: {
    exchange: HttpExchange
    bodyTruncated: boolean
}): ReactElement {
    const [copyError, setCopyError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const { response } = exchange
    const summary = summarizeResponse(exchange)

    const copy = async (): Promise<void> => {
        setCopied(false)
        setCopyError(null)
        try {
            await navigator.clipboard.writeText(bodyAsText(response?.body))
            setCopied(true)
        } catch (error) {
            setCopyError(
                `Could not copy to the clipboard${error instanceof Error ? `: ${error.message}` : '.'}`,
            )
        }
    }

    return (
        <section
            aria-label="Response"
            className="flex flex-col gap-4 rounded border border-ax-border-neutral-subtle bg-white px-5 py-[18px]"
        >
            <h2 className={EYEBROW_CLASSES}>Response</h2>

            <p className="text-14 font-mono break-all text-ax-text-neutral-subtle">
                {exchange.request.method} {exchange.request.url}
            </p>

            {response === null ? (
                <ErrorNote
                    title="No response received"
                    detail={exchange.error ?? 'The request failed before the server answered.'}
                />
            ) : (
                <>
                    <p className="text-16 font-semibold">
                        <span className="font-mono">
                            HTTP {response.status}
                            {response.statusText ? ` ${response.statusText}` : ''}
                        </span>
                        <span className="text-ax-text-neutral-subtle font-normal">
                            {' '}
                            · {Math.round(exchange.durationMs)} ms
                        </span>
                    </p>

                    {summary.bundle && (
                        <p className="text-16">
                            Bundle:{' '}
                            {summary.bundle.total === null ? 'no total' : `total ${summary.bundle.total}`},{' '}
                            {summary.bundle.entries} {summary.bundle.entries === 1 ? 'entry' : 'entries'} in
                            this page
                        </p>
                    )}

                    {summary.issues.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <h3 className="text-14 font-semibold text-ax-text-neutral-subtle">
                                OperationOutcome issues
                            </h3>
                            <ul className="text-16 flex flex-col gap-1">
                                {summary.issues.map((issue, index) => (
                                    <li key={index} className="break-words">
                                        <span className="font-mono font-semibold">
                                            {issue.severity} ({issue.code})
                                        </span>
                                        {issue.text !== '' && <span>: {issue.text}</span>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {bodyTruncated && (
                        <div
                            role="note"
                            className="text-16 rounded border border-l-8 border-ax-border-warning bg-ax-bg-warning-soft px-4 py-3 text-ax-text-warning"
                        >
                            The response body was larger than 1 MB and was cut off.
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <h3 className="text-14 font-semibold text-ax-text-neutral-subtle">Headers</h3>
                        <HeadersTable headers={response.headers} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-14 font-semibold text-ax-text-neutral-subtle">Body</h3>
                            <button
                                type="button"
                                onClick={() => void copy()}
                                className="text-16 text-ax-text-accent min-h-11 font-semibold underline"
                            >
                                {copied ? 'Copied' : 'Copy body'}
                            </button>
                        </div>
                        {copyError && <ErrorNote title="Copy failed" detail={copyError} />}
                        {response.body === null ? (
                            <p className="text-13 text-ax-text-neutral-subtle italic">Empty body</p>
                        ) : (
                            <JsonBlock value={response.body} />
                        )}
                    </div>
                </>
            )}
        </section>
    )
}

export function DebugConsole({
    session,
    resourceTypeOptions = [],
}: {
    session: DebugSessionView
    resourceTypeOptions?: readonly string[]
}): ReactElement {
    const [draft, setDraft] = useState<RequestDraft>(EMPTY_DRAFT)
    const [sending, setSending] = useState(false)
    const [draftError, setDraftError] = useState<string | null>(null)
    const [result, setResult] = useState<DebugResult | null>(null)

    const send = async (): Promise<void> => {
        const built = buildRequest(draft)
        if (!built.ok) {
            setDraftError(built.error)
            return
        }

        setDraftError(null)
        setSending(true)
        try {
            setResult(await sendRequest(built.request))
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <header>
                <h1 className="text-32 font-bold">Debug mode</h1>
                <p className="text-16 mt-2 max-w-[70ch]">
                    Send FHIR requests to the server from your launch. The access token stays on the server.
                </p>
                <p className="text-14 mt-2 font-mono break-all text-ax-text-neutral-subtle">
                    {session.fhirBaseUrl}
                </p>
                <Link
                    href="/report"
                    className="text-16 text-ax-text-accent inline-flex min-h-11 items-center underline"
                >
                    ← Back to the report
                </Link>
            </header>

            <RequestBuilder
                draft={draft}
                onChange={setDraft}
                onSend={() => void send()}
                sending={sending}
                resourceTypeOptions={resourceTypeOptions}
            />

            {draftError && <ErrorNote title="Fix the request" detail={draftError} />}

            <div aria-live="polite" className="flex flex-col gap-6">
                {result?.kind === 'failure' && (
                    <ErrorNote title={`Request failed (${result.error})`} detail={result.detail} />
                )}
                {result?.kind === 'exchange' && (
                    <ResponseView exchange={result.exchange} bodyTruncated={result.bodyTruncated} />
                )}
            </div>
        </div>
    )
}
