import clsx from 'clsx'
import type { ReactElement } from 'react'

import type { Verdict } from '#core/run'

const VERDICT_LABEL: Record<Verdict, string> = {
    pass: 'Pass',
    'pass-with-warnings': 'Pass, with warnings',
    fail: 'Fail',
    // Deliberately not worded as any kind of pass: some checks could not run, so conformance was
    // never fully demonstrated. See `summarize` in `#core/run/report`.
    skipped: 'Incomplete',
}

/**
 * `skipped` gets a dashed neutral border and no status hue — never a colour that could read as a
 * soft pass. Same "we don't know" language as `SectionStatusBadge`'s `skipped` state.
 */
const VERDICT_CLASSES: Record<Verdict, string> = {
    pass: 'border-ax-border-success bg-ax-bg-success-soft text-ax-text-success',
    'pass-with-warnings': 'border-ax-border-warning bg-ax-bg-warning-soft text-ax-text-warning',
    fail: 'border-ax-border-danger bg-ax-bg-danger-soft text-ax-text-danger',
    skipped: 'border-dashed border-ax-border-neutral bg-ax-bg-neutral-soft text-ax-text-neutral',
}

export function VerdictBanner({ verdict, sentence }: { verdict: Verdict; sentence: string }): ReactElement {
    return (
        <div role="status" className={clsx('rounded border border-l-8 px-6 py-5', VERDICT_CLASSES[verdict])}>
            <p className="text-13 font-bold tracking-eyebrow text-ax-text-neutral-subtle uppercase">
                Verdict
            </p>
            <h1 className="text-34 mt-1 font-bold">{VERDICT_LABEL[verdict]}</h1>
            <p className="text-17 mt-2 max-w-[70ch]">{sentence}</p>
        </div>
    )
}
