import Link from 'next/link'
import type { ReactElement } from 'react'

export default function NotFound(): ReactElement {
    return (
        <main className="mx-auto max-w-2xl p-8">
            <h1 className="text-2xl font-semibold">Page not found</h1>
            <p className="mt-2 text-neutral-700">
                There is nothing at this address. If you followed a link from a support ticket, the validation
                report it pointed to may have expired.
            </p>
            <Link href="/" className="mt-6 inline-block underline hover:no-underline">
                ← Back to the validator
            </Link>
        </main>
    )
}
