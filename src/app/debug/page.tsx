import Link from 'next/link'
import type { ReactElement } from 'react'

import { toDebugSessionView } from '#core/debug/session-view'
import { readSessionIdFromCookies } from '#core/session/session-cookie'
import { createSessionStore } from '#core/storage/session-store'
import { DebugConsole } from '#components/debug/DebugConsole'
import { PageTransition } from '#components/transitions/PageTransition'

export const dynamic = 'force-dynamic'

function DebugUnavailable(): ReactElement {
    return (
        <PageTransition>
            <main id="main-content" className="mx-auto max-w-[960px] px-6 pt-8 pb-24">
                <h1 className="text-32 text-balance font-bold">Debug mode is not available</h1>
                <p className="text-16 mt-2 max-w-[70ch]">
                    Debug mode needs a completed SMART launch in this browser. Launch the validator from your EHR,
                    or use the mock EHR on the front page, then open Debug mode from the report. The session may
                    also have expired.
                </p>
                <Link
                    href="/"
                    className="text-16 text-ax-text-accent mt-5 inline-flex min-h-11 items-center underline"
                >
                    ← Back to the validator
                </Link>
            </main>
        </PageTransition>
    )
}

export default async function DebugPage(): Promise<ReactElement> {
    const sessionId = await readSessionIdFromCookies()
    const session = sessionId ? await (await createSessionStore()).get(sessionId) : null

    if (session?.state !== 'active') return <DebugUnavailable />

    return (
        <PageTransition>
            <main id="main-content" className="mx-auto max-w-[1280px] px-6 pt-8 pb-24">
                <DebugConsole session={toDebugSessionView(session)} />
            </main>
        </PageTransition>
    )
}
