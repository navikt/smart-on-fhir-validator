import Link from 'next/link'
import type { ReactElement } from 'react'

export default function NotFound(): ReactElement {
    return (
        <main className="mx-auto max-w-[960px] px-6 pt-10 pb-20">
            <h1 className="text-32 font-semibold">Page not found</h1>
            <p className="text-18 mt-4 max-w-[68ch]">
                There is nothing at this address. If you followed a link from a support ticket, the validation
                report it pointed to may have expired.
            </p>
            <Link
                href="/"
                className="text-16 text-ax-text-accent mt-6 inline-flex min-h-11 items-center underline"
            >
                Back to the validator
            </Link>
        </main>
    )
}
