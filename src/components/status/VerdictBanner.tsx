import clsx from 'clsx'
import type { ReactElement } from 'react'

import type { Verdict } from '#core/run'

const VERDICT_LABEL: Record<Verdict, string> = {
    pass: 'Pass',
    'pass-with-warnings': 'Pass, with warnings',
    fail: 'Fail',
    // Deliberately not worded as any kind of pass: some checks could not run at all, so general
    // conformance was never fully demonstrated. See `summarize` in `#core/run/report`.
    skipped: 'Incomplete — some checks could not run',
}

const VERDICT_CLASSES: Record<Verdict, string> = {
    pass: 'border-green-400 bg-green-50 text-green-900',
    'pass-with-warnings': 'border-amber-400 bg-amber-50 text-amber-900',
    fail: 'border-red-400 bg-red-50 text-red-900',
    skipped: 'border-dashed border-neutral-400 bg-neutral-50 text-neutral-800',
}

export function VerdictBanner({ verdict }: { verdict: Verdict }): ReactElement {
    return (
        <div
            role="status"
            className={clsx('rounded-lg border-2 px-5 py-4 text-lg font-semibold', VERDICT_CLASSES[verdict])}
        >
            {VERDICT_LABEL[verdict]}
        </div>
    )
}
