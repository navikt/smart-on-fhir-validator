import Link from 'next/link'
import type { ReactElement } from 'react'

import { readSessionIdFromCookies } from '#core/session/session-cookie'
import { ReportView } from '#components/report/ReportView'
import { parseSeverityFilter } from '#components/report/derive'

import { getReportStore } from './report-store'

export const dynamic = 'force-dynamic'

function ReportUnavailable(): ReactElement {
    return (
        <main className="mx-auto max-w-[960px] px-6 pt-8 pb-24">
            <h1 className="text-32 font-bold">No report available</h1>
            <p className="text-16 mt-2 max-w-[70ch]">
                There is no validation report for this browser session. It may have expired, already been
                read, or you may not have completed a launch yet.
            </p>
            <Link
                href="/"
                className="text-16 text-ax-text-accent mt-5 inline-flex min-h-11 items-center underline"
            >
                ← Back to the validator
            </Link>
        </main>
    )
}

export default async function ReportPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<ReactElement> {
    const sessionId = await readSessionIdFromCookies()
    const report = sessionId ? await getReportStore().get(sessionId) : null

    if (!report) return <ReportUnavailable />

    const params = await searchParams
    const severityParam = params.severity
    const severityFilter = parseSeverityFilter(
        Array.isArray(severityParam) ? severityParam[0] : severityParam,
    )

    return (
        <main className="mx-auto max-w-[960px] px-6 pt-8 pb-24">
            <ReportView report={report} severityFilter={severityFilter} />
        </main>
    )
}
