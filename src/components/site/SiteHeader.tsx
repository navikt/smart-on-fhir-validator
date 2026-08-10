import Image from 'next/image'
import Link from 'next/link'
import type { ReactElement } from 'react'

export function SiteHeader(): ReactElement {
    return (
        <header className="bg-brandblue-strong">
            <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-x-6 gap-y-4 px-6 py-4">
                <Image src="/nav_logo_hvit.svg" alt="Nav" width={45} height={28} className="flex-none" />
                <div className="flex flex-col justify-center">
                    <Link href="/" className="flex min-h-11 items-center">
                        <span className="text-18 font-semibold tracking-[-0.01em] text-white">
                            SMART on FHIR Validator
                        </span>
                    </Link>
                    <span className="text-14 text-white/78">
                        Conformance testing for SMART App Launch and FHIR APIs
                    </span>
                </div>
                <span className="ml-auto text-13 whitespace-nowrap text-white/65">
                    Arbeids- og velferdsetaten
                </span>
            </div>
        </header>
    )
}
