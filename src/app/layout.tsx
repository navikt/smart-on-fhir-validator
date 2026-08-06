import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import './globals.css'

export const metadata: Metadata = {
    title: 'SMART on FHIR Validator',
    description: "Validates an EHR's SMART on FHIR and FHIR R4 implementation against Nav's requirements",
}

export default function RootLayout({ children }: LayoutProps<'/'>): ReactElement {
    return (
        <html lang="en" className="h-full antialiased">
            <body className="min-h-full flex flex-col">{children}</body>
        </html>
    )
}
