'use client'

import Link from 'next/link'

type ErrorPageProps = {
    error: Error & { digest?: string }
    reset: () => void
}

/**
 * Only catches genuinely unexpected rendering bugs in this app's own UI: every SMART/FHIR
 * failure the validator detects is a `ReportFinding` or `SmartError` rendered as ordinary
 * content, so a crash here is never a finding about the EHR being validated.
 */
export default function Error({ error, reset }: ErrorPageProps) {
    return (
        <main className="mx-auto max-w-[960px] px-6 pt-10 pb-20">
            <h1 className="text-32 font-semibold">Something went wrong</h1>
            <p className="text-18 mt-4 max-w-[68ch]">
                The validator hit an unexpected error while rendering this page. This is a bug in the
                validator itself, not a finding about the EHR you launched from.
            </p>
            {error.digest && (
                <p className="text-14 text-ax-text-neutral-subtle mt-2">
                    Reference: <span className="font-mono">{error.digest}</span>
                </p>
            )}
            <div className="mt-6 flex flex-wrap gap-4">
                <button
                    type="button"
                    onClick={reset}
                    className="border-ax-border-neutral-strong hover:bg-ax-bg-neutral-soft text-16 inline-flex min-h-12 items-center rounded border px-4 font-semibold"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="border-ax-border-neutral-strong hover:bg-ax-bg-neutral-soft text-16 inline-flex min-h-12 items-center rounded border px-4 font-semibold"
                >
                    Back to the validator
                </Link>
            </div>
        </main>
    )
}
