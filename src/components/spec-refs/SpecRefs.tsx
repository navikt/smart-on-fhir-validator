import type { ReactElement } from 'react'

import type { RefTypes } from '#validation/common-refs'

import { classifyHl7Ref, REF_KIND_LABEL, type RefKind } from './classify-ref'

type Chip = { kind: RefKind; href: string }

function chipsFor(refs: RefTypes): Chip[] {
    const chips: Chip[] = []

    if (refs.hl7) chips.push({ kind: classifyHl7Ref(refs.hl7), href: refs.hl7 })
    if (refs.nav) chips.push({ kind: 'nav', href: refs.nav })
    if (refs.simplifier) chips.push({ kind: 'profile', href: refs.simplifier })

    return chips
}

const CHIP_CLASSES: Record<RefKind, string> = {
    smart: 'border-purple-300 bg-purple-50 text-purple-900',
    fhir: 'border-blue-300 bg-blue-50 text-blue-900',
    nav: 'border-teal-300 bg-teal-50 text-teal-900',
    profile: 'border-neutral-300 bg-neutral-50 text-neutral-800',
}

/**
 * Renders the spec citations on a finding as labelled links, so a vendor can tell at a glance
 * whether a finding blocks general SMART/FHIR conformance or only the Nav-specific integration.
 */
export function SpecRefs({ refs }: { refs: RefTypes }): ReactElement | null {
    const chips = chipsFor(refs)
    if (chips.length === 0) return null

    return (
        <ul className="flex flex-wrap gap-2">
            {chips.map((chip) => (
                <li key={chip.href}>
                    <a
                        href={chip.href}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium hover:underline ${CHIP_CLASSES[chip.kind]}`}
                    >
                        {REF_KIND_LABEL[chip.kind]}
                        <span aria-hidden="true">↗</span>
                    </a>
                </li>
            ))}
        </ul>
    )
}
