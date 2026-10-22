import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { SiteHeader } from '#components/site/SiteHeader'

import './globals.css'

export const metadata: Metadata = {
    title: 'SMART on FHIR Validator',
    description: "Validates an EHR's SMART on FHIR and FHIR R4 implementation against Nav's requirements",
}

export default function RootLayout({ children }: LayoutProps<'/'>): ReactElement {
    return (
        <html lang="en" className="antialiased">
            <body className="bg-ax-bg-default text-ax-text-neutral">
                <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-ax-text-accent"
                >
                    Skip to main content
                </a>
                <SiteHeader />
                {children}
            </body>
        </html>
    )
}
