import { clsx } from 'clsx'
import type { ReactElement } from 'react'

import type { Severity } from '#validation/validation'

/**
 * Monospace and the literal enum value: a developer cross-referencing the JSON download should
 * see the exact same token here as in the report they downloaded.
 */
const SEVERITY_CLASSES: Record<Severity, string> = {
    ERROR: 'border border-ax-bg-danger-strong bg-ax-bg-danger-strong text-white',
    WARNING: 'border border-ax-border-warning bg-ax-bg-warning-soft text-ax-text-warning',
    INFO: 'border border-ax-border-info bg-ax-bg-info-soft text-ax-text-info',
    OK: 'border border-ax-border-success bg-ax-bg-success-soft text-ax-text-success',
}

export function SeverityBadge({ severity }: { severity: Severity }): ReactElement {
    return (
        <span
            className={clsx(
                'text-12 tracking-chip inline-block rounded-[3px] px-2 py-0.5 font-bold whitespace-nowrap uppercase',
                SEVERITY_CLASSES[severity],
            )}
        >
            {severity}
        </span>
    )
}
