import Link from 'next/link'
import type { ReactElement } from 'react'

export type FlowErrorProps = {
    /** Which step of the SMART launch failed, shown so a vendor knows where to start debugging. */
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
 * Rendered when `handleLaunch`/`handleCallback` return a `SmartError`. Not a validation finding:
 * no report exists yet at this point, so it is shown as a plain, deliberately neutral error page
 * rather than the danger-coloured verdict treatment.
 */
export function FlowError({ stage, error, detail }: FlowErrorProps): ReactElement {
    return (
        <main className="mx-auto max-w-[960px] px-6 pt-10 pb-20">
            <h1 className="text-32 font-semibold">Launch failed</h1>
            <p className="text-18 mt-4 max-w-[68ch]">
                Something went wrong while {STAGE_LABEL[stage]}. This happened before any validation report
                could be produced, so there is no evidence to show yet. The detail below is everything the
                validator knows.
            </p>

            <section className="border-ax-border-neutral-subtle mt-8 rounded border bg-white">
                <header className="border-ax-border-neutral-subtle bg-ax-bg-neutral-soft rounded-t border-b px-5 py-3">
                    <h2 className="text-13 tracking-eyebrow text-ax-text-neutral-subtle font-bold uppercase">
                        Error detail
                    </h2>
                </header>
                <dl className="flex flex-col gap-4 px-5 py-[18px]">
                    <div>
                        <dt className="text-14 text-ax-text-neutral-subtle font-semibold">Error code</dt>
                        <dd className="text-14 font-mono break-all">{error}</dd>
                    </div>
                    {detail && (
                        <div>
                            <dt className="text-14 text-ax-text-neutral-subtle font-semibold">Detail</dt>
                            <dd className="text-16">{detail}</dd>
                        </div>
                    )}
                </dl>
            </section>

            <Link
                href="/"
                className="text-16 text-ax-text-accent mt-6 inline-flex min-h-11 items-center underline"
            >
                Back to the validator
            </Link>
        </main>
    )
}
