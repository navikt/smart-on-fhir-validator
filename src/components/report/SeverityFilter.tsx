import clsx from 'clsx'
import Link from 'next/link'
import type { ReactElement } from 'react'

import type { SeverityFilterCounts, SeverityFilterValue } from './derive'

type Pill = {
    value: SeverityFilterValue
    label: string
    count?: number
}

function pillsFor(counts: SeverityFilterCounts): Pill[] {
    return [
        { value: 'all', label: 'Everything' },
        { value: 'error', label: 'Errors only', count: counts.error },
        { value: 'warning', label: 'Errors + warnings', count: counts.warning },
        { value: 'nottested', label: 'Not tested', count: counts.nottested },
    ]
}

export function SeverityFilter({
    active,
    counts,
}: {
    active: SeverityFilterValue
    counts: SeverityFilterCounts
}): ReactElement {
    return (
        <nav aria-label="Filter findings by severity" className="flex flex-wrap items-baseline gap-2">
            <span className="text-14 font-semibold">Show</span>
            {pillsFor(counts).map((pill) => {
                const isActive = pill.value === active

                return (
                    <Link
                        key={pill.value}
                        href={`?severity=${pill.value}`}
                        aria-current={isActive ? 'page' : undefined}
                        className={clsx(
                            'text-14 rounded-pill inline-flex min-h-11 items-center px-3.5 font-semibold',
                            isActive
                                ? 'border-2 border-brandblue-strong bg-brandblue-strong text-white'
                                : 'border border-ax-border-neutral-subtle bg-white text-ax-text-neutral hover:bg-ax-bg-neutral-soft',
                        )}
                    >
                        {pill.label}
                        {pill.count !== undefined && <span className="ml-1.5 font-bold">{pill.count}</span>}
                    </Link>
                )
            })}
        </nav>
    )
}
