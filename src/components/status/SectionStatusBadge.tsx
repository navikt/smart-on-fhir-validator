import clsx from 'clsx'
import type { ReactElement } from 'react'

import type { SectionStatus } from '#core/run'

const STATUS_LABEL: Record<SectionStatus, string> = {
    passed: 'Passed',
    warned: 'Passed with warnings',
    failed: 'Failed',
    skipped: 'Not tested',
}

/**
 * `skipped` gets a dashed border and neutral grey, never green: a section that could not run
 * proved nothing, and must never be mistaken for a pass.
 */
const STATUS_CLASSES: Record<SectionStatus, string> = {
    passed: 'border border-ax-border-success bg-ax-bg-success-soft text-ax-text-success',
    warned: 'border border-ax-border-warning bg-ax-bg-warning-soft text-ax-text-warning',
    failed: 'border border-ax-bg-danger-strong bg-ax-bg-danger-strong text-white',
    skipped: 'border border-dashed border-ax-border-neutral bg-white text-ax-text-neutral',
}

export function SectionStatusBadge({ status }: { status: SectionStatus }): ReactElement {
    return (
        <span
            className={clsx(
                'text-14 inline-flex items-center rounded px-3 py-1 font-semibold whitespace-nowrap',
                STATUS_CLASSES[status],
            )}
        >
            {STATUS_LABEL[status]}
        </span>
    )
}
