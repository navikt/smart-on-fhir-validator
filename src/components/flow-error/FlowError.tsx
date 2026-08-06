import Link from 'next/link'
import type { ReactElement } from 'react'

export type FlowErrorProps = {
    /** Which step of the SMART launch failed — shown so a vendor knows where to start debugging. */
    stage: 'launch' | 'callback'
    /** The `SmartError.error` machine-readable code. */
    error: string
    /** The `SmartError.detail`, when the failure produced one. */
    detail?: string
}

const STAGE_LABEL: Record<FlowErrorProps['stage'], string> = {
    launch: 'starting the launch',
    callback: 'completing the launch after returning from your authorization server',
}

/**
 * Rendered when `handleLaunch`/`handleCallback` (`#core/smart`) return a `SmartError` instead of
 * succeeding. This is not itself a validation finding — no report exists yet at this point — so
 * it is shown as a plain error page rather than folded into `/report`.
 */
export function FlowError({ stage, error, detail }: FlowErrorProps): ReactElement {
    return (
        <main className="mx-auto max-w-2xl p-8">
            <h1 className="text-2xl font-semibold text-red-800">Launch failed</h1>
            <p className="mt-2 text-neutral-700">
                Something went wrong while {STAGE_LABEL[stage]}. This happened before any validation report
                could be produced, so there is no evidence to show yet — the detail below is everything the
                validator knows.
            </p>
            <dl className="mt-6 space-y-2 rounded border border-neutral-300 p-4 text-sm">
                <div className="flex gap-2">
                    <dt className="font-medium text-neutral-600">Error code</dt>
                    <dd className="font-mono text-neutral-900">{error}</dd>
                </div>
                {detail && (
                    <div className="flex gap-2">
                        <dt className="font-medium text-neutral-600">Detail</dt>
                        <dd className="text-neutral-900">{detail}</dd>
                    </div>
                )}
            </dl>
            <Link href="/" className="mt-6 inline-block underline hover:no-underline">
                ← Back to the validator
            </Link>
        </main>
    )
}
