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
        <html lang="en" className="h-full antialiased">
            <body className="flex min-h-full flex-col bg-neutral-50 text-neutral-900">
                <SiteHeader />
                {children}
            </body>
        </html>
    )
}
