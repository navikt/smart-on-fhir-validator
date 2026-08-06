import type { ReactElement } from 'react'

import type { HttpExchange } from '#core/http/exchange'
import type { ReportSection, SectionCategory } from '#core/run'
import { SectionStatusBadge } from '#components/status/SectionStatusBadge'

import { findExchange } from './find-exchange'
import { FindingItem } from './FindingItem'

const CATEGORY_LABEL: Record<SectionCategory, string> = {
    smart: 'SMART App Launch',
    'fhir-read': 'FHIR read',
    'fhir-write': 'FHIR write-back',
}

export function SectionCard({
    section,
    exchanges,
}: {
    section: ReportSection
    exchanges: readonly HttpExchange[]
}): ReactElement {
    return (
        <article className="rounded-lg border border-neutral-300 p-4" aria-labelledby={`${section.id}-title`}>
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                        {CATEGORY_LABEL[section.category]}
                    </p>
                    <h3 id={`${section.id}-title`} className="text-lg font-semibold text-neutral-900">
                        {section.title}
                    </h3>
                </div>
                <SectionStatusBadge status={section.status} />
            </header>

            {section.description && (
                <p className="mt-2 rounded bg-neutral-50 p-2 text-sm text-neutral-700 italic">
                    {section.description}
                </p>
            )}

            {section.findings.length > 0 && (
                <ul className="mt-4 space-y-3">
                    {section.findings.map((finding) => (
                        <FindingItem
                            key={finding.id}
                            finding={finding}
                            exchange={findExchange(exchanges, finding.exchangeId)}
                        />
                    ))}
                </ul>
            )}
        </article>
    )
}
