import type { ReactElement } from 'react'

import { getAppOrigin } from './app-origin'
import { isMockEhrEnabled } from './mock-ehr-enabled'

const LAUNCH_CONTRACT = 'GET /launch?iss={fhir base url}&launch={launch token}'

async function MockEhrCard(): Promise<ReactElement | null> {
    if (!isMockEhrEnabled()) return null

    const origin = await getAppOrigin()
    const mockIss = `${origin}/api/mocks/fhir`
    const launchUrl = `/launch?iss=${encodeURIComponent(mockIss)}&launch=demo`

    return (
        <section className="border-ax-border-accent-strong flex flex-col rounded border-2 bg-white p-5">
            <h2 className="text-22 font-semibold">Try it against the mock EHR</h2>
            <p className="text-16 mt-2 flex-1">
                Runs the same validation this tool performs against your own system, but against an in-repo
                mock EHR that conforms by default. Useful for seeing a known-good report before pointing this
                tool at your own server.
            </p>
            <a
                href={launchUrl}
                className="bg-ax-bg-accent-strong hover:bg-ax-bg-accent-strong-pressed text-17 mt-4 inline-flex min-h-12 items-center justify-center rounded px-4 font-semibold text-white"
            >
                Launch the mock EHR
            </a>
        </section>
    )
}

async function RegisterEhrSection(): Promise<ReactElement> {
    const origin = await getAppOrigin()

    const registrationItems = [
        { label: 'Launch URL', value: `${origin}/launch` },
        { label: 'Redirect URI', value: `${origin}/callback` },
        {
            label: 'Requested scopes',
            value: 'openid fhirUser launch launch/patient offline_access patient/Patient.rs patient/Practitioner.rs patient/PractitionerRole.rs patient/Organization.rs patient/Encounter.rs patient/Condition.rs patient/DocumentReference.cruds patient/Binary.cruds patient/QuestionnaireResponse.cruds',
        },
        { label: 'JWKS URL (for private_key_jwt)', value: `${origin}/.well-known/jwks.json` },
    ]

    return (
        <section className="border-ax-border-neutral-subtle bg-ax-bg-neutral-soft mt-5 rounded border p-[22px]">
            <h2 className="text-13 tracking-eyebrow text-ax-text-neutral-subtle font-bold uppercase">
                Register your EHR
            </h2>
            <p className="text-16 mt-2">
                Register a static client by opening a pull request against{' '}
                <a href="https://github.com/navikt/smart-on-fhir-validator" className="underline">
                    this repository
                </a>
                , or expose a <code>registration_endpoint</code> so this app can register itself dynamically.
                A static registration needs:
            </p>
            <table className="text-14 border-ax-border-neutral-subtle mt-3 w-full table-fixed border-collapse overflow-hidden rounded border bg-white">
                <tbody>
                    {registrationItems.map((item) => (
                        <tr
                            key={item.label}
                            className="border-ax-border-neutral-subtle border-t first:border-t-0"
                        >
                            <th
                                scope="row"
                                className="border-ax-border-neutral-subtle w-[220px] border-r px-3 py-2 text-left align-top font-semibold"
                            >
                                {item.label}
                            </th>
                            <td className="px-3 py-2 align-top font-mono break-all">{item.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-16 mt-3">
                Three client-authentication types are supported: <strong>public</strong> (PKCE, no secret),{' '}
                <strong>symmetric</strong> (<code>client_secret_basic</code> or{' '}
                <code>client_secret_post</code>, with a <code>clientSecretEnv</code>), and{' '}
                <strong>asymmetric</strong> (<code>private_key_jwt</code>, signed with this app&apos;s one
                published key). See{' '}
                <a
                    href="https://github.com/navikt/smart-on-fhir-validator#register-your-ehr"
                    className="underline"
                >
                    the README&apos;s registration section
                </a>{' '}
                for the exact pull-request mechanism.
            </p>
            <p className="text-16 mt-3">
                Nav&apos;s outbound network policy only allows connections to an explicit allowlist: make sure
                every server-side host your integration touches (FHIR base URL, authorization endpoint, token
                endpoint, JWKS URI) is added to that allowlist in the same pull request, as described in{' '}
                <a
                    href="https://github.com/navikt/smart-on-fhir-validator#step-2-allow-network-access"
                    className="underline"
                >
                    the README&apos;s network access section
                </a>
                .
            </p>
        </section>
    )
}

function StandaloneLaunchCard(): ReactElement {
    return (
        <section className="border-ax-border-neutral-subtle flex flex-col rounded border bg-white p-5">
            <h2 className="text-22 font-semibold">Launch standalone</h2>
            <p className="text-16 mt-2 flex-1">
                Starts a launch directly, without an EHR session. Supply your FHIR server&apos;s base URL, the{' '}
                <code>iss</code> value a SMART launch would provide.
            </p>
            <form action="/launch" method="get" className="mt-4 flex flex-col gap-1">
                <label htmlFor="iss" className="text-14 font-semibold">
                    FHIR base URL
                </label>
                <input
                    id="iss"
                    name="iss"
                    type="url"
                    required
                    placeholder="https://ehr.example.com/fhir"
                    className="border-ax-border-neutral-strong text-16 font-mono box-border min-h-12 w-full rounded border px-3"
                />
                <p className="text-14 text-ax-text-neutral-subtle mt-1">
                    Must expose <code>/.well-known/smart-configuration</code>.
                </p>
                <button
                    type="submit"
                    className="border-ax-border-accent-strong text-ax-text-accent hover:bg-ax-bg-accent-soft text-17 mt-3 inline-flex min-h-12 items-center justify-center rounded border-2 bg-white px-4 font-semibold"
                >
                    Launch
                </button>
            </form>
        </section>
    )
}

export default function HomePage(): ReactElement {
    return (
        <main className="mx-auto max-w-[960px] px-6 pt-10 pb-20">
            <h1 className="text-32 max-w-[22ch] font-semibold">Check your SMART on FHIR implementation</h1>

            <p className="text-18 text-pretty mt-4 max-w-[68ch]">
                This validator checks that your EHR&apos;s SMART on FHIR and FHIR R4 implementation conforms
                to the SMART App Launch specification and to Nav&apos;s requirements for the sykmelding
                write-back flow. Every check is evidence-based: the report shows the exact request this tool
                sent and the exact response it received, so you can reproduce any finding yourself with{' '}
                <code>curl</code>.
            </p>

            <section className="border-ax-border-neutral-subtle bg-ax-bg-neutral-soft mt-8 rounded border p-[22px]">
                <h2 className="text-13 tracking-eyebrow text-ax-text-neutral-subtle font-bold uppercase">
                    How a real EHR launches it
                </h2>
                <p className="text-16 mt-2">
                    Configure your EHR to launch this app at <code>/launch</code>. When a user starts the app,
                    your EHR redirects the browser here with the standard SMART EHR-launch parameters:
                </p>
                <pre className="border-ax-border-neutral-subtle text-14 mt-3 overflow-x-auto rounded border bg-white p-3 whitespace-pre">
                    {LAUNCH_CONTRACT}
                </pre>
            </section>

            <RegisterEhrSection />

            <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
                <MockEhrCard />
                <StandaloneLaunchCard />
            </div>
        </main>
    )
}
