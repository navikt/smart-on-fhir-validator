import type { ReactElement } from 'react'

import type { ReportSummary } from '#core/run'
import type { Severity } from '#validation/validation'

const SEVERITY_ORDER: Severity[] = ['ERROR', 'WARNING', 'INFO', 'OK']

const SEVERITY_LABEL: Record<Severity, string> = {
    ERROR: 'Errors',
    WARNING: 'Warnings',
    INFO: 'Info',
    OK: 'Passed checks',
}

const SEVERITY_MEANING: Record<Severity, string> = {
    ERROR: 'Breaks a MUST requirement',
    WARNING: 'Allowed, but discouraged',
    INFO: 'Observed behaviour, no verdict',
    OK: 'Requirement demonstrated',
}

const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
    ERROR: 'text-ax-text-danger',
    WARNING: 'text-ax-text-warning',
    INFO: 'text-ax-text-info',
    OK: 'text-ax-text-success',
}

/**
 * The "Meaning" column exists so a vendor developer seeing the report for the first time does
 * not have to guess what a severity implies.
 */
export function ReportSummaryCounts({ summary }: { summary: ReportSummary }): ReactElement {
    return (
        <div className="overflow-x-auto rounded border border-ax-border-neutral-subtle">
            <table className="text-16 w-full min-w-[420px] border-collapse">
                <caption className="sr-only">Finding counts by severity</caption>
                <thead>
                    <tr className="border-b border-ax-border-neutral-subtle bg-ax-bg-neutral-soft text-left">
                        <th scope="col" className="px-4 py-2 font-semibold">
                            Result
                        </th>
                        <th scope="col" className="w-[8ch] px-4 py-2 text-right font-semibold">
                            Count
                        </th>
                        <th scope="col" className="text-ax-text-neutral px-4 py-2 font-semibold">
                            Meaning
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {SEVERITY_ORDER.map((severity) => (
                        <tr key={severity} className="border-ax-border-neutral-subtleA border-b">
                            <th
                                scope="row"
                                className={`px-4 py-2 text-left font-semibold ${SEVERITY_TEXT_CLASS[severity]}`}
                            >
                                {SEVERITY_LABEL[severity]}
                            </th>
                            <td className="w-[8ch] px-4 py-2 text-right font-bold [font-variant-numeric:tabular-nums]">
                                {summary.counts[severity]}
                            </td>
                            <td className="text-ax-text-neutral px-4 py-2">{SEVERITY_MEANING[severity]}</td>
                        </tr>
                    ))}
                    <tr className="bg-ax-bg-neutral-soft">
                        <th scope="row" className="px-4 py-2 text-left font-semibold">
                            Sections not tested
                        </th>
                        <td className="w-[8ch] px-4 py-2 text-right font-bold [font-variant-numeric:tabular-nums]">
                            {summary.sectionsSkipped}
                        </td>
                        <td className="text-ax-text-neutral px-4 py-2">
                            Could not run, no verdict either way
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    )
}
