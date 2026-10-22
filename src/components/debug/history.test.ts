import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT } from './draft'
import { MAX_HISTORY, pushHistory, type HistoryEntry } from './history'

const entry = (id: number): HistoryEntry => ({
    id,
    draft: EMPTY_DRAFT,
    result: { kind: 'failure', error: 'network_error', detail: 'offline' },
    createdAt: '2030-01-01T00:00:00.000Z',
})

describe('pushHistory', () => {
    it('puts the newest entry first', () => {
        const history = pushHistory(pushHistory([], entry(1)), entry(2))

        expect(history.map((item) => item.id)).toEqual([2, 1])
    })

    it('keeps at most 20 entries and drops the oldest', () => {
        let history: HistoryEntry[] = []
        for (let id = 1; id <= MAX_HISTORY + 5; id++) history = pushHistory(history, entry(id))

        expect(MAX_HISTORY).toBe(20)
        expect(history).toHaveLength(20)
        expect(history[0]?.id).toBe(25)
        expect(history.at(-1)?.id).toBe(6)
    })

    it('does not mutate the previous history', () => {
        const previous = [entry(1)]
        pushHistory(previous, entry(2))

        expect(previous).toHaveLength(1)
    })
})
