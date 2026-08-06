import type { ReactElement } from 'react'

import type { HttpExchange } from '#core/http/exchange'
import type { ReportFinding } from '#core/run'
import { SeverityBadge } from '#components/status/SeverityBadge'
import { SpecRefs } from '#components/spec-refs/SpecRefs'
import { ExchangePanel } from '#components/exchange/ExchangePanel'

export function FindingItem({
    finding,
    exchange,
}: {
    finding: ReportFinding
    exchange: HttpExchange | null
}): ReactElement {
    return (
        <li className="space-y-2 border-l-4 border-neutral-200 py-2 pl-4">
            <div className="flex flex-wrap items-start gap-2">
                <SeverityBadge severity={finding.severity} />
                <p className="min-w-0 grow text-sm text-neutral-900">{finding.message}</p>
            </div>
            {finding.refs && <SpecRefs refs={finding.refs} />}
            {exchange && <ExchangePanel exchange={exchange} />}
        </li>
    )
}
