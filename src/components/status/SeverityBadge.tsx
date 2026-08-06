import clsx from 'clsx'
import type { ReactElement } from 'react'

import type { Severity } from '#validation/validation'

const SEVERITY_LABEL: Record<Severity, string> = {
    ERROR: 'Error',
    WARNING: 'Warning',
    INFO: 'Info',
    OK: 'OK',
}

/**
 * Severity is never conveyed by colour alone: every badge carries a text label and a distinct
 * icon glyph, so the report reads correctly for colour-blind users and in a black-and-white
 * printout alike.
 */
const SEVERITY_ICON: Record<Severity, string> = {
    ERROR: '✕',
    WARNING: '▲',
    INFO: 'ℹ',
    OK: '✓',
}

const SEVERITY_CLASSES: Record<Severity, string> = {
    ERROR: 'bg-red-100 text-red-900 border-red-300',
    WARNING: 'bg-amber-100 text-amber-900 border-amber-300',
    INFO: 'bg-sky-100 text-sky-900 border-sky-300',
    OK: 'bg-green-100 text-green-900 border-green-300',
}

export function SeverityBadge({ severity }: { severity: Severity }): ReactElement {
    return (
        <span
            className={clsx(
                'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
                SEVERITY_CLASSES[severity],
            )}
        >
            <span aria-hidden="true">{SEVERITY_ICON[severity]}</span>
            {SEVERITY_LABEL[severity]}
        </span>
    )
}
