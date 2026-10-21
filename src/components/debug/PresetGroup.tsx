import type { ReactElement } from 'react'

import type { RequestDraft } from './draft'
import type { Preset } from './presets'
import { CARD_CLASSES, CHIP_BUTTON_CLASSES, EYEBROW_CLASSES } from './styles'

export function PresetGroup({
    title,
    intro,
    presets,
    onSelect,
    layout,
}: {
    title: string
    intro: string
    presets: readonly Preset[]
    onSelect: (draft: RequestDraft) => void
    layout: 'chips' | 'list'
}): ReactElement | null {
    if (presets.length === 0) return null

    return (
        <section aria-label={title} className={CARD_CLASSES}>
            <h2 className={EYEBROW_CLASSES}>{title}</h2>
            <p className="text-14 max-w-[70ch] text-ax-text-neutral-subtle">{intro}</p>
            <ul className={layout === 'chips' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-3'}>
                {presets.map((preset) => (
                    <li key={preset.key} className={layout === 'list' ? 'flex flex-col gap-1' : undefined}>
                        <button
                            type="button"
                            disabled={preset.disabledReason !== null}
                            onClick={() => onSelect(preset.draft)}
                            className={
                                layout === 'chips'
                                    ? CHIP_BUTTON_CLASSES
                                    : `${CHIP_BUTTON_CLASSES} w-full font-sans font-semibold`
                            }
                        >
                            {preset.label}
                        </button>
                        {layout === 'list' && (
                            <p className="text-14 max-w-[70ch] text-ax-text-neutral-subtle">
                                {preset.disabledReason ?? preset.description}
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    )
}
