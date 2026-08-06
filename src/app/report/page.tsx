import Link from 'next/link'
import type { ReactElement } from 'react'

import { readSessionIdFromCookies } from '#core/session/session-cookie'
import { ReportView } from '#components/report/ReportView'

import { getReportStore } from './report-store'

export const dynamic = 'force-dynamic'

function ReportUnavailable(): ReactElement {
    return (
        <main className="mx-auto max-w-2xl p-8">
            <h1 className="text-2xl font-semibold">No report available</h1>
            <p className="mt-2 text-neutral-700">
                There is no validation report for this browser session. It may have expired, already been
                read, or you may not have completed a launch yet.
            </p>
            <Link href="/" className="mt-6 inline-block underline hover:no-underline">
                ← Back to the validator
            </Link>
        </main>
    )
}

export default async function ReportPage(): Promise<ReactElement> {
    const sessionId = await readSessionIdFromCookies()
    const report = sessionId ? await getReportStore().get(sessionId) : null

    if (!report) return <ReportUnavailable />

    return (
        <main className="mx-auto max-w-4xl p-8">
            <ReportView report={report} />
        </main>
    )
}
