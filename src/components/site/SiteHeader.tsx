import Link from 'next/link'
import type { ReactElement } from 'react'

export function SiteHeader(): ReactElement {
    return (
        <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto max-w-4xl px-8 py-6">
                <Link href="/" className="text-xl font-semibold text-neutral-900 hover:underline">
                    Nav SMART on FHIR Validator
                </Link>
                <p className="mt-1 text-sm text-neutral-600">
                    Evidence-based conformance checks for the SMART App Launch and FHIR R4 sykmelding flow.
                </p>
            </div>
        </header>
    )
}
