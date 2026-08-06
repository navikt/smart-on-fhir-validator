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

export function ReportSummaryCounts({ summary }: { summary: ReportSummary }): ReactElement {
    return (
        <table className="w-full max-w-md border-collapse text-sm">
            <caption className="sr-only">Finding counts by severity</caption>
            <tbody>
                {SEVERITY_ORDER.map((severity) => (
                    <tr key={severity} className="border-b border-neutral-200">
                        <th scope="row" className="py-1 pr-4 text-left font-normal text-neutral-600">
                            {SEVERITY_LABEL[severity]}
                        </th>
                        <td className="py-1 text-right font-mono">{summary.counts[severity]}</td>
                    </tr>
                ))}
                <tr>
                    <th scope="row" className="py-1 pr-4 text-left font-normal text-neutral-600">
                        Sections not tested
                    </th>
                    <td className="py-1 text-right font-mono">{summary.sectionsSkipped}</td>
                </tr>
            </tbody>
        </table>
    )
}
