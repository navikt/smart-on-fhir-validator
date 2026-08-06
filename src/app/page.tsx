import type { ReactElement } from 'react'

import { getAppOrigin } from './app-origin'
import { isMockEhrEnabled } from './mock-ehr-enabled'

async function MockEhrTryIt(): Promise<ReactElement | null> {
    if (!isMockEhrEnabled()) return null

    const origin = await getAppOrigin()
    const mockIss = `${origin}/api/mocks/fhir`
    const launchUrl = `/launch?iss=${encodeURIComponent(mockIss)}&launch=demo`

    return (
        <section className="rounded-lg border border-neutral-300 bg-white p-6">
            <h2 className="text-lg font-semibold">Try it against the built-in mock EHR</h2>
            <p className="mt-2 text-sm text-neutral-700">
                Runs the exact same validation this tool would run against your own system, but against an
                in-repo mock EHR that is conformant by default — a good way to see a known-good report before
                pointing this tool at your own server.
            </p>
            <a
                href={launchUrl}
                className="mt-4 inline-block rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
            >
                Launch the mock EHR
            </a>
        </section>
    )
}

function StandaloneLaunchForm(): ReactElement {
    return (
        <section className="rounded-lg border border-neutral-300 bg-white p-6">
            <h2 className="text-lg font-semibold">Launch standalone</h2>
            <p className="mt-2 text-sm text-neutral-700">
                Testing outside an EHR session? Enter your FHIR server&apos;s base URL (the <code>iss</code> a
                SMART launch would supply) to start a launch directly.
            </p>
            <form action="/launch" method="get" className="mt-4 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label htmlFor="iss" className="text-sm font-medium text-neutral-700">
                        FHIR server base URL
                    </label>
                    <input
                        id="iss"
                        name="iss"
                        type="url"
                        required
                        placeholder="https://ehr.example.com/fhir"
                        className="w-80 max-w-full rounded border border-neutral-400 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
                    />
                </div>
                <button
                    type="submit"
                    className="rounded border border-neutral-400 px-4 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
                >
                    Launch
                </button>
            </form>
        </section>
    )
}

export default function HomePage(): ReactElement {
    return (
        <main className="mx-auto max-w-4xl space-y-8 p-8">
            <section>
                <h1 className="text-2xl font-semibold">What this tool does</h1>
                <p className="mt-3 text-neutral-700">
                    This validator checks that your EHR&apos;s SMART on FHIR and FHIR R4 implementation
                    conforms to the SMART App Launch specification and to Nav&apos;s requirements for the
                    sykmelding write-back flow.
                </p>
                <p className="mt-3 text-neutral-700">
                    Every check is evidence-based: the report shows the exact request this tool sent to your
                    server and the exact response it received, so every finding is something you can reproduce
                    yourself with <code>curl</code> — not just a pass/fail claim.
                </p>
            </section>

            <section>
                <h2 className="text-lg font-semibold">How to launch from your EHR</h2>
                <p className="mt-2 text-sm text-neutral-700">
                    Configure your EHR to launch this app at <code>/launch</code>. When a user starts the app,
                    your EHR should redirect the browser here with the standard SMART EHR-launch parameters:
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-neutral-900 p-3 text-xs text-neutral-100">
                    {'GET /launch?iss={your FHIR server base URL}&launch={opaque launch id}'}
                </pre>
            </section>

            <MockEhrTryIt />
            <StandaloneLaunchForm />
        </main>
    )
}
