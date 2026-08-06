import { NextResponse } from 'next/server'

import { readSessionIdFromCookies } from '#core/session/session-cookie'

import { getReportStore } from '../report-store'

export const runtime = 'nodejs'

/** Serves the same report shown on `/report` as a downloadable JSON file, so a vendor can attach
 * it verbatim to a support ticket. */
export async function GET(): Promise<NextResponse> {
    const sessionId = await readSessionIdFromCookies()
    const report = sessionId ? await getReportStore().get(sessionId) : null

    if (!report) {
        return NextResponse.json({ error: 'no_report_available' }, { status: 404 })
    }

    return new NextResponse(JSON.stringify(report, null, 2), {
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="smart-validator-report-${report.generatedAt.slice(0, 10)}.json"`,
        },
    })
}
