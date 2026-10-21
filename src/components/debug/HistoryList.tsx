import type { ReactElement } from 'react'

import type { HistoryEntry } from './history'
import { CARD_CLASSES, EYEBROW_CLASSES } from './styles'

function describeEntry({ draft, result }: HistoryEntry): string {
    const method = draft.method === 'Other' ? draft.otherMethod.toUpperCase() : draft.method
    const path = [draft.resourceType, draft.id].filter((part) => part !== '').join('/')
    const query = draft.query === '' ? '' : `?${draft.query.replace(/^\?/, '')}`
    const outcome =
        result.kind === 'exchange'
            ? result.exchange.response
                ? `HTTP ${result.exchange.response.status}`
                : 'No response'
            : 'Failed'

    return `${method} /${path}${query} · ${outcome}`
}

export function HistoryList({
    entries,
    onRestore,
}: {
    entries: readonly HistoryEntry[]
    onRestore: (entry: HistoryEntry) => void
}): ReactElement | null {
    if (entries.length === 0) return null

    return (
        <section aria-label="History" className={CARD_CLASSES}>
            <h2 className={EYEBROW_CLASSES}>History</h2>
            <p className="text-14 text-ax-text-neutral-subtle">
                Requests from this page, newest first. Reloading clears them.
            </p>
            <ol className="flex flex-col gap-1">
                {entries.map((entry) => (
                    <li key={entry.id}>
                        <button
                            type="button"
                            onClick={() => onRestore(entry)}
                            className="text-14 text-ax-text-accent min-h-11 w-full text-left font-mono break-all underline"
                        >
                            {describeEntry(entry)}
                        </button>
                    </li>
                ))}
            </ol>
        </section>
    )
}
