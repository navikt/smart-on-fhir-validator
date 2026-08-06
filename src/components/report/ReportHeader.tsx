import type { ReactElement } from 'react'

import type { ValidationReport } from '#core/run'
import { VerdictBanner } from '#components/status/VerdictBanner'

import { ReportSummaryCounts } from './ReportSummaryCounts'

export function ReportHeader({ report }: { report: ValidationReport }): ReactElement {
    return (
        <header className="space-y-4">
            <VerdictBanner verdict={report.summary.verdict} />

            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                    <dt className="font-medium text-neutral-600">Issuer</dt>
                    <dd className="break-all">{report.issuer}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="font-medium text-neutral-600">FHIR base URL</dt>
                    <dd className="break-all">{report.fhirBaseUrl}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="font-medium text-neutral-600">Client ID</dt>
                    <dd className="break-all">{report.clientId}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="font-medium text-neutral-600">Generated at</dt>
                    <dd>{report.generatedAt}</dd>
                </div>
            </dl>

            <ReportSummaryCounts summary={report.summary} />

            <a
                href="/report/download"
                download
                className="inline-block rounded border border-neutral-400 px-4 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
            >
                Download full report as JSON
            </a>
        </header>
    )
}
