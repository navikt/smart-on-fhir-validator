import type { ReactElement } from 'react'

import type { ValidationReport } from '#core/run'

import { ReportHeader } from './ReportHeader'
import { SectionCard } from './SectionCard'

export function ReportView({ report }: { report: ValidationReport }): ReactElement {
    return (
        <div className="space-y-8">
            <ReportHeader report={report} />

            <ul className="space-y-6">
                {report.sections.map((section) => (
                    <li key={section.id}>
                        <SectionCard section={section} exchanges={report.exchanges} />
                    </li>
                ))}
            </ul>
        </div>
    )
}
