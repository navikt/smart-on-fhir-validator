import { describe, expect, it } from 'vitest'

import type { ReportSection, ReportSummary } from '#core/run'

import {
    filterSection,
    parseSeverityFilter,
    sectionSummaryLine,
    severityFilterCounts,
    verdictSentence,
} from './derive'

function summary(overrides: Partial<ReportSummary> = {}): ReportSummary {
    return {
        counts: { OK: 0, INFO: 0, WARNING: 0, ERROR: 0 },
        sectionsSkipped: 0,
        verdict: 'pass',
        ...overrides,
    }
}

function section(overrides: Partial<ReportSection> = {}): ReportSection {
    return {
        id: 's1',
        title: 'A section',
        category: 'smart',
        status: 'passed',
        findings: [],
        ...overrides,
    }
}

describe('verdictSentence', () => {
    it('states the real pass count, singular when there is exactly one check', () => {
        expect(verdictSentence(summary({ counts: { OK: 1, INFO: 0, WARNING: 0, ERROR: 0 } }), 1)).toBe(
            '1 check passed across 1 section; no errors or warnings were found.',
        )
    })

    it('pluralises pass counts and section counts', () => {
        expect(verdictSentence(summary({ counts: { OK: 41, INFO: 3, WARNING: 0, ERROR: 0 } }), 17)).toBe(
            '41 checks passed across 17 sections; no errors or warnings were found.',
        )
    })

    it('states both the pass count and the warning count for pass-with-warnings', () => {
        expect(
            verdictSentence(
                summary({
                    verdict: 'pass-with-warnings',
                    counts: { OK: 6, INFO: 0, WARNING: 1, ERROR: 0 },
                }),
                7,
            ),
        ).toBe('6 checks passed, with 1 warning; no errors were found.')
    })

    it('states the error count for fail and never words it as a pass', () => {
        const sentence = verdictSentence(
            summary({ verdict: 'fail', counts: { OK: 3, INFO: 0, WARNING: 0, ERROR: 4 } }),
            19,
        )

        expect(sentence).toBe('4 errors found across 19 sections; conformance was not demonstrated.')
        expect(sentence).not.toMatch(/pass/i)
    })

    it('states what was skipped and that conformance was not demonstrated either way for skipped', () => {
        const sentence = verdictSentence(summary({ verdict: 'skipped', sectionsSkipped: 6 }), 17)

        expect(sentence).toBe('6 of 17 sections could not run. Conformance was not demonstrated either way.')
        expect(sentence).not.toMatch(/\bpass\b/i)
    })

    it('uses singular "section" when there is exactly one section skipped out of one', () => {
        expect(verdictSentence(summary({ verdict: 'skipped', sectionsSkipped: 1 }), 1)).toBe(
            '1 of 1 section could not run. Conformance was not demonstrated either way.',
        )
    })
})

describe('sectionSummaryLine', () => {
    it('summarises a clean pass as "N checks passed."', () => {
        const findings = Array.from({ length: 6 }, (_, index) => ({
            id: `f${index}`,
            message: 'ok',
            severity: 'OK' as const,
            exchangeId: null,
        }))

        expect(sectionSummaryLine(section({ status: 'passed', findings }))).toBe('6 checks passed.')
    })

    it('appends the warning count for a warned section', () => {
        const findings = [
            ...Array.from({ length: 6 }, (_, index) => ({
                id: `ok${index}`,
                message: 'ok',
                severity: 'OK' as const,
                exchangeId: null,
            })),
            { id: 'w1', message: 'warn', severity: 'WARNING' as const, exchangeId: null },
        ]

        expect(sectionSummaryLine(section({ status: 'warned', findings }))).toBe(
            '6 checks passed, 1 warning.',
        )
    })

    it('pluralises singular counts correctly', () => {
        const findings = [{ id: 'ok1', message: 'ok', severity: 'OK' as const, exchangeId: null }]

        expect(sectionSummaryLine(section({ findings }))).toBe('1 check passed.')
    })

    it('includes an info count when info findings are present alongside passes', () => {
        const findings = [
            { id: 'ok1', message: 'ok', severity: 'OK' as const, exchangeId: null },
            { id: 'i1', message: 'info', severity: 'INFO' as const, exchangeId: null },
            { id: 'i2', message: 'info', severity: 'INFO' as const, exchangeId: null },
        ]

        expect(sectionSummaryLine(section({ findings }))).toBe('1 check passed, 2 info.')
    })

    it('omits the pass count entirely when nothing passed, rather than claiming "0 checks passed"', () => {
        const findings = [{ id: 'w1', message: 'warn', severity: 'WARNING' as const, exchangeId: null }]

        expect(sectionSummaryLine(section({ status: 'warned', findings }))).toBe('1 warning.')
    })

    it('states that no checks were recorded when a section has no findings at all', () => {
        expect(sectionSummaryLine(section({ findings: [] }))).toBe('No checks recorded.')
    })
})

describe('parseSeverityFilter', () => {
    it.each(['all', 'error', 'warning', 'nottested'] as const)('accepts the known value %s', (value) => {
        expect(parseSeverityFilter(value)).toBe(value)
    })

    it('falls back to "all" for an unrecognised value', () => {
        expect(parseSeverityFilter('bogus')).toBe('all')
    })

    it('falls back to "all" when the param is missing', () => {
        expect(parseSeverityFilter(undefined)).toBe('all')
    })
})

describe('severityFilterCounts', () => {
    it('reads the error and not-tested counts straight from the summary', () => {
        const counts = severityFilterCounts(
            summary({ counts: { OK: 41, INFO: 9, WARNING: 3, ERROR: 4 }, sectionsSkipped: 2 }),
        )

        expect(counts.error).toBe(4)
        expect(counts.nottested).toBe(2)
    })

    it('sums errors and warnings for the combined "errors + warnings" pill', () => {
        const counts = severityFilterCounts(summary({ counts: { OK: 0, INFO: 0, WARNING: 3, ERROR: 4 } }))

        expect(counts.warning).toBe(7)
    })
})

describe('filterSection', () => {
    const failing = section({
        status: 'failed',
        findings: [
            { id: 'e1', message: 'boom', severity: 'ERROR', exchangeId: null },
            { id: 'w1', message: 'meh', severity: 'WARNING', exchangeId: null },
            { id: 'o1', message: 'fine', severity: 'OK', exchangeId: null },
        ],
    })

    const skipped = section({ id: 's2', status: 'skipped', description: 'no patient context' })

    it('returns the section unchanged for "all"', () => {
        expect(filterSection(failing, 'all')).toBe(failing)
    })

    it('keeps only ERROR findings for "error" and drops sections left with none', () => {
        const result = filterSection(failing, 'error')

        expect(result?.findings.map((finding) => finding.id)).toEqual(['e1'])
        expect(filterSection(skipped, 'error')).toBeNull()
    })

    it('keeps ERROR and WARNING findings for "warning"', () => {
        const result = filterSection(failing, 'warning')

        expect(result?.findings.map((finding) => finding.id)).toEqual(['e1', 'w1'])
    })

    it('matches a section by its own skipped status for "nottested", regardless of findings', () => {
        expect(filterSection(skipped, 'nottested')).toBe(skipped)
        expect(filterSection(failing, 'nottested')).toBeNull()
    })

    it('hides a section whose findings are all filtered out', () => {
        const okOnly = section({
            status: 'passed',
            findings: [{ id: 'o1', message: 'fine', severity: 'OK', exchangeId: null }],
        })

        expect(filterSection(okOnly, 'error')).toBeNull()
    })
})
