import Link from 'next/link'
import type { ReactElement } from 'react'

import type { ValidationReport } from '#core/run'
import { VerdictBanner } from '#components/status/VerdictBanner'

import { filterSection, severityFilterCounts, verdictSentence, type SeverityFilterValue } from './derive'
import { RunDetailsCard } from './RunDetailsCard'
import { ReportSummaryCounts } from './ReportSummaryCounts'
import { SeverityFilter } from './SeverityFilter'
import { SectionCard } from './SectionCard'

function EmptyFilterPanel(): ReactElement {
    return (
        <div className="rounded border border-dashed border-ax-border-neutral bg-ax-bg-neutral-soft px-5 py-6 text-center">
            <p className="text-16">No findings match this filter.</p>
            <Link
                href="?severity=all"
                className="text-16 text-ax-text-accent mt-1 inline-flex min-h-11 items-center underline"
            >
                Everything
            </Link>
        </div>
    )
}

export function ReportView({
    report,
    severityFilter,
}: {
    report: ValidationReport
    severityFilter: SeverityFilterValue
}): ReactElement {
    const sentence = verdictSentence(report.summary, report.sections.length)
    const pillCounts = severityFilterCounts(report.summary)
    const sections = report.sections
        .map((section) => filterSection(section, severityFilter))
        .filter((section) => section !== null)

    return (
        <div className="flex flex-col gap-8">
            <VerdictBanner verdict={report.summary.verdict} sentence={sentence} />

            <RunDetailsCard report={report} />

            <div className="flex flex-col gap-3">
                <h2 className="text-13 font-bold tracking-eyebrow text-ax-text-neutral-subtle uppercase">
                    Summary
                </h2>
                <ReportSummaryCounts summary={report.summary} />
            </div>

            <SeverityFilter active={severityFilter} counts={pillCounts} />

            {sections.length === 0 ? (
                <EmptyFilterPanel />
            ) : (
                <div className="flex flex-col gap-3">
                    <h2 className="text-13 font-bold tracking-eyebrow text-ax-text-neutral-subtle uppercase">
                        Sections
                    </h2>
                    {sections.map((section) => (
                        <SectionCard key={section.id} section={section} exchanges={report.exchanges} />
                    ))}
                </div>
            )}
        </div>
    )
}
