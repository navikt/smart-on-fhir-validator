import clsx from 'clsx'
import type { ReactElement } from 'react'

import type { HttpExchange } from '#core/http/exchange'
import type { ReportSection, SectionCategory } from '#core/run'
import { SectionStatusBadge } from '#components/status/SectionStatusBadge'

import { findExchange } from './find-exchange'
import { FindingItem } from './FindingItem'
import { sectionSummaryLine } from './derive'

const CATEGORY_LABEL: Record<SectionCategory, string> = {
    smart: 'SMART App Launch',
    'fhir-conformance': 'FHIR conformance',
    'fhir-read': 'FHIR read',
    'fhir-write': 'FHIR write-back',
}

/**
 * Card chrome by status. `failed` gets both a coloured border and a tinted header so it stays
 * findable while scrolling past up to 19 cards. `skipped` gets a dashed border and a muted body
 * and never a status hue: it recedes, but is never hidden — it must not be mistaken for a pass.
 */
const CARD_CLASSES: Record<ReportSection['status'], string> = {
    passed: 'border-ax-border-neutral-subtle bg-white',
    warned: 'border-ax-border-neutral-subtle bg-white',
    failed: 'border-ax-border-danger bg-white',
    skipped: 'border-dashed border-ax-border-neutral bg-ax-bg-neutral-soft',
}

const HEADER_CLASSES: Record<ReportSection['status'], string> = {
    passed: 'bg-white',
    warned: 'bg-white',
    failed: 'bg-ax-bg-danger-soft',
    skipped: 'bg-transparent',
}

function SectionFindings({
    section,
    exchanges,
}: {
    section: ReportSection
    exchanges: readonly HttpExchange[]
}): ReactElement | null {
    if (section.findings.length === 0) return null

    return (
        <ul className="flex flex-col gap-3.5">
            {section.findings.map((finding) => (
                <FindingItem
                    key={finding.id}
                    finding={finding}
                    exchange={findExchange(exchanges, finding.exchangeId)}
                />
            ))}
        </ul>
    )
}

export function SectionCard({
    section,
    exchanges,
}: {
    section: ReportSection
    exchanges: readonly HttpExchange[]
}): ReactElement {
    const findings = <SectionFindings section={section} exchanges={exchanges} />

    return (
        <article
            className={clsx('rounded border', CARD_CLASSES[section.status])}
            aria-labelledby={`${section.id}-title`}
        >
            <header
                className={clsx(
                    'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-t border-b px-5 py-4',
                    section.status === 'skipped'
                        ? 'border-dashed border-ax-border-neutral'
                        : 'border-ax-border-neutral-subtle',
                    HEADER_CLASSES[section.status],
                )}
            >
                <div className="min-w-0 flex-[1_1_260px]">
                    <p className="text-13 tracking-[0.04em] text-ax-text-neutral-subtle font-semibold uppercase">
                        {CATEGORY_LABEL[section.category]}
                    </p>
                    <h3 id={`${section.id}-title`} className="text-20 leading-[1.3] font-semibold">
                        {section.title}
                    </h3>
                </div>
                <SectionStatusBadge status={section.status} />
            </header>

            <div className="flex flex-col gap-3 px-5 py-4">
                {section.status === 'skipped' ? (
                    <>
                        {section.description && <p className="text-16 max-w-[70ch]">{section.description}</p>}
                        <p className="text-16 font-semibold">This is not a pass.</p>
                    </>
                ) : (
                    <>
                        {section.description && <p className="text-16 max-w-[70ch]">{section.description}</p>}

                        {section.status === 'failed' ? (
                            findings
                        ) : section.findings.length > 0 ? (
                            <details>
                                <summary className="text-16 -my-2.5 flex min-h-11 cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
                                    {sectionSummaryLine(section)}
                                </summary>
                                <div className="mt-3.5">{findings}</div>
                            </details>
                        ) : (
                            <p className="text-16">{sectionSummaryLine(section)}</p>
                        )}
                    </>
                )}
            </div>
        </article>
    )
}
