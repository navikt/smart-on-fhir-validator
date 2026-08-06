import clsx from 'clsx'
import type { ReactElement } from 'react'

import type { SectionStatus } from '#core/run'

const STATUS_LABEL: Record<SectionStatus, string> = {
    passed: 'Passed',
    warned: 'Passed with warnings',
    failed: 'Failed',
    skipped: 'Not tested',
}

const STATUS_ICON: Record<SectionStatus, string> = {
    passed: '✓',
    warned: '▲',
    failed: '✕',
    skipped: '—',
}

/**
 * `skipped` gets its own visual treatment — a dashed border and a neutral grey, never green —
 * distinct from every other status. A section that could not run proved nothing, and must never
 * be mistaken for a pass at a glance, colour-blind or not. See `#core/run/report`'s `SectionStatus`.
 */
const STATUS_CLASSES: Record<SectionStatus, string> = {
    passed: 'border-green-300 bg-green-100 text-green-900',
    warned: 'border-amber-300 bg-amber-100 text-amber-900',
    failed: 'border-red-300 bg-red-100 text-red-900',
    skipped: 'border-dashed border-neutral-400 bg-neutral-100 text-neutral-700',
}

export function SectionStatusBadge({ status }: { status: SectionStatus }): ReactElement {
    return (
        <span
            className={clsx(
                'inline-flex items-center gap-1.5 rounded border-2 px-3 py-1 text-sm font-semibold whitespace-nowrap',
                STATUS_CLASSES[status],
            )}
        >
            <span aria-hidden="true">{STATUS_ICON[status]}</span>
            {STATUS_LABEL[status]}
        </span>
    )
}
