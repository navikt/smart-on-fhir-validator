import { useId, useState, type ReactElement } from 'react'

import type { HistoryEntry } from './history'
import { CARD_CLASSES, EYEBROW_CLASSES } from './styles'

const COLLAPSED_COUNT = 3

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
    const [expanded, setExpanded] = useState(false)
    const listId = useId()

    if (entries.length === 0) return null

    const collapsible = entries.length > COLLAPSED_COUNT
    const visible = collapsible && !expanded ? entries.slice(0, COLLAPSED_COUNT) : entries

    return (
        <section aria-label="History" className={CARD_CLASSES}>
            <h2 className={EYEBROW_CLASSES}>History</h2>
            <p className="text-14 text-ax-text-neutral-subtle">
                Requests from this page, newest first. Reloading clears them.
            </p>
            <ol id={listId} className="flex flex-col gap-1">
                {visible.map((entry) => (
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
            {collapsible && (
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onClick={() => setExpanded((value) => !value)}
                    className="text-14 text-ax-text-accent min-h-11 self-start underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-border-focus"
                >
                    {expanded ? 'Show less' : `Show more (${entries.length - COLLAPSED_COUNT})`}
                </button>
            )}
        </section>
    )
}
