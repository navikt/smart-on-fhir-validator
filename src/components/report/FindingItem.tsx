import clsx from 'clsx'
import type { ReactElement } from 'react'

import type { HttpExchange } from '#core/http/exchange'
import type { ReportFinding } from '#core/run'
import { SeverityBadge } from '#components/status/SeverityBadge'
import { SpecRefs } from '#components/spec-refs/SpecRefs'
import { ExchangePanel } from '#components/exchange/ExchangePanel'

/** Severity earns emphasis: ERROR and WARNING messages are semibold, INFO and OK stay regular. */
const EMPHASISED: ReportFinding['severity'][] = ['ERROR', 'WARNING']

export function FindingItem({
    finding,
    exchange,
}: {
    finding: ReportFinding
    exchange: HttpExchange | null
}): ReactElement {
    return (
        <li className="border-ax-border-neutral-subtleA flex flex-col gap-2 border-t pt-3.5 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                <SeverityBadge severity={finding.severity} />
                <p
                    className={clsx(
                        'text-17 flex-[1_1_260px] leading-[1.4]',
                        EMPHASISED.includes(finding.severity) ? 'font-semibold' : 'font-normal',
                    )}
                >
                    {finding.message}
                </p>
            </div>
            {finding.refs && finding.refs.length > 0 && <SpecRefs refs={finding.refs} />}
            {exchange && <ExchangePanel exchange={exchange} />}
        </li>
    )
}
