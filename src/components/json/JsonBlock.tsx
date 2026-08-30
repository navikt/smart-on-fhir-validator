import type { ReactElement } from 'react'

function toDisplayText(value: unknown): string {
    // Bodies that failed to parse as JSON arrive here as plain strings (see ExchangePanel); render
    // them verbatim rather than JSON.stringify-ing them into a quoted, escaped string literal.
    if (typeof value === 'string') return value

    return JSON.stringify(value, null, 2) ?? 'null'
}

/** The value is the evidence, not syntax colouring; the full report is downloadable as JSON. */
export function JsonBlock({ value }: { value: unknown }): ReactElement {
    return (
        <pre
            role="code"
            tabIndex={0}
            className="text-13 max-h-96 overflow-auto rounded-[3px] bg-ax-bg-neutral-soft p-3 leading-[1.6]"
        >
            {toDisplayText(value)}
        </pre>
    )
}
