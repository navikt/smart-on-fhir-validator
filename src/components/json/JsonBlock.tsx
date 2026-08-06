import type { ReactElement } from 'react'

function toDisplayText(value: unknown): string {
    // Bodies that failed to parse as JSON arrive here as plain strings (see ExchangePanel) — render
    // them verbatim rather than JSON.stringify-ing them into a quoted, escaped string literal.
    if (typeof value === 'string') return value

    return JSON.stringify(value, null, 2) ?? 'null'
}

/**
 * Pretty-prints a JSON-serialisable value (or a raw non-JSON string body) as plain monospace text.
 * A Server Component with no client JS: the value here is the exact evidence, not syntax colouring,
 * and the full report is already downloadable as JSON for anyone who needs to inspect it further.
 */
export function JsonBlock({ value }: { value: unknown }): ReactElement {
    return (
        <pre
            role="code"
            tabIndex={0}
            className="max-h-96 overflow-auto rounded bg-neutral-50 p-2 font-mono text-xs break-all whitespace-pre-wrap"
        >
            {toDisplayText(value)}
        </pre>
    )
}
