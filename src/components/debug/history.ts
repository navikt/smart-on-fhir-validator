import type { RequestDraft } from './draft'
import type { DebugResult } from './result'

export const MAX_HISTORY = 20

export type HistoryEntry = {
    id: number
    draft: RequestDraft
    result: DebugResult
    createdAt: string
}

export function pushHistory(
    history: readonly HistoryEntry[],
    entry: HistoryEntry,
    max = MAX_HISTORY,
): HistoryEntry[] {
    return [entry, ...history].slice(0, max)
}
