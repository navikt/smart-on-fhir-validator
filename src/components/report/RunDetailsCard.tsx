import type { ReactElement } from 'react'

import type { ValidationReport } from '#core/run'

export function RunDetailsCard({ report }: { report: ValidationReport }): ReactElement {
    return (
        <section className="rounded border border-ax-border-neutral-subtle bg-white">
            <header className="rounded-t border-b border-ax-border-neutral-subtle bg-ax-bg-neutral-soft px-5 py-3">
                <h2 className="text-13 font-bold tracking-eyebrow text-ax-text-neutral-subtle uppercase">
                    Run details
                </h2>
            </header>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-8 gap-y-4 px-5 py-[18px]">
                <dl className="contents">
                    <div>
                        <dt className="text-14 font-semibold text-ax-text-neutral-subtle">FHIR base URL</dt>
                        <dd className="text-14 font-mono leading-[1.45] break-all">{report.fhirBaseUrl}</dd>
                    </div>
                    <div>
                        <dt className="text-14 font-semibold text-ax-text-neutral-subtle">Client ID</dt>
                        <dd className="text-14 font-mono leading-[1.45] break-all">{report.clientId}</dd>
                    </div>
                    <div>
                        <dt className="text-14 font-semibold text-ax-text-neutral-subtle">Generated</dt>
                        <dd className="text-14 font-mono leading-[1.45] break-all">{report.generatedAt}</dd>
                    </div>
                </dl>
            </div>

            <div className="px-5 pb-3.5">
                <a
                    href="/report/download"
                    download
                    className="text-16 font-semibold text-ax-text-accent inline-flex min-h-11 items-center underline"
                >
                    Download full report as JSON
                </a>
            </div>
        </section>
    )
}
