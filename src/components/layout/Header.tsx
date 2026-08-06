'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'

export default function Header(): ReactElement {
    const pathname = usePathname()

    return (
        <div className="ml-8 mb-4 pb-5">
            <h1 className="text-4xl">Nav SMART on FHIR validation</h1>
            <p className="text-sm">
                Collection of resource fetches and writes to verify if a FHIR server is compliant with the
                FHIR specification
            </p>
            {pathname !== '/' && (
                <Link href="/" className="text-blue-900 hover:text-blue-700">
                    <span>← </span>
                    <span className="underline">Back to validations</span>
                </Link>
            )}
        </div>
    )
}
