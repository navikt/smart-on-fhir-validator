'use client'

import Link from 'next/link'

type ErrorPageProps = {
    error: Error & { digest?: string }
    reset: () => void
}

/**
 * Next.js requires an error boundary to be a Client Component. This only catches genuinely
 * unexpected rendering bugs in this app's own UI — every SMART/FHIR failure the validator itself
 * detects is already a `ReportFinding` or a `SmartError`, rendered as ordinary content rather than
 * thrown, so a crash here is never a finding about the EHR being validated.
 */
export default function Error({ error, reset }: ErrorPageProps) {
    return (
        <main className="mx-auto max-w-2xl p-8">
            <h1 className="text-2xl font-semibold text-red-800">Something went wrong</h1>
            <p className="mt-2 text-neutral-700">
                The validator hit an unexpected error while rendering this page. This is a bug in the
                validator itself, not a finding about the EHR you launched from.
            </p>
            {error.digest && (
                <p className="mt-2 text-sm text-neutral-500">
                    Reference: <span className="font-mono">{error.digest}</span>
                </p>
            )}
            <div className="mt-6 flex gap-4">
                <button
                    type="button"
                    onClick={reset}
                    className="rounded border border-neutral-400 px-4 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="rounded border border-neutral-400 px-4 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
                >
                    Back to the validator
                </Link>
            </div>
        </main>
    )
}
