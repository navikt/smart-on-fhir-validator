import type { ReactElement } from 'react'

import type { RequestDraft } from './draft'
import type { Preset } from './presets'
import { CARD_CLASSES, CHIP_BUTTON_CLASSES, EYEBROW_CLASSES, PRESET_BUTTON_CLASSES } from './styles'

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
            <ul
                className={
                    layout === 'chips' ? 'flex flex-wrap gap-2' : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
                }
            >
                {presets.map((preset) => (
                    <li key={preset.key}>
                        {layout === 'chips' ? (
                            <button
                                type="button"
                                disabled={preset.disabledReason !== null}
                                onClick={() => onSelect(preset.draft)}
                                className={CHIP_BUTTON_CLASSES}
                            >
                                {preset.label}
                            </button>
                        ) : (
                            <button
                                type="button"
                                disabled={preset.disabledReason !== null}
                                onClick={() => onSelect(preset.draft)}
                                className={`${PRESET_BUTTON_CLASSES} h-full`}
                            >
                                <span className="text-16 font-semibold">{preset.label}</span>
                                <span className="text-14">{preset.disabledReason ?? preset.description}</span>
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    )
}
