import type { ReactElement } from 'react'

import type { RefTypes } from '#validation/common-refs'

/**
 * Renders the spec citations on a finding as links, each labelled with the citation itself
 * (e.g. "SMART App Launch 2.2 §Scope Equivalence") so a reader can cross-check the claim.
 *
 * Opens in the same tab: this app renders inside an EHR vendor's iframe, where `target="_blank"`
 * would break out of the vendor's own navigation.
 */
export function SpecRefs({ refs }: { refs: RefTypes }): ReactElement | null {
    if (refs.length === 0) return null

    return (
        <ul className="-my-1.5 flex list-none flex-wrap gap-x-4">
            {refs.map((ref) => (
                <li key={ref.href}>
                    <a
                        href={ref.href}
                        rel="noopener"
                        className="text-15 text-ax-text-accent inline-flex min-h-11 items-center underline"
                    >
                        {ref.cite}
                    </a>
                </li>
            ))}
        </ul>
    )
}
