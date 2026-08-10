/**
 * Pure derivations the report page needs but the model does not carry directly: a plain-language
 * verdict sentence, a one-line collapsed section summary, and the severity filter. See
 * `#core/run/report` for the model these read from.
 */

import type { ReportSection, ReportSummary } from '#core/run'
import type { Severity } from '#validation/validation'

function plural(count: number, word: string): string {
    return count === 1 ? word : `${word}s`
}

/**
 * One plain sentence stating the real counts behind a verdict. The `skipped` verdict states both
 * what could not run and that conformance was not demonstrated either way — it must never read
 * as any kind of pass.
 */
export function verdictSentence(summary: ReportSummary, sectionsTotal: number): string {
    const { counts, sectionsSkipped, verdict } = summary

    switch (verdict) {
        case 'skipped':
            return (
                `${sectionsSkipped} of ${sectionsTotal} ${plural(sectionsTotal, 'section')} could not run. ` +
                `Conformance was not demonstrated either way.`
            )
        case 'fail':
            return `${counts.ERROR} ${plural(counts.ERROR, 'error')} found across ${sectionsTotal} ${plural(sectionsTotal, 'section')}; conformance was not demonstrated.`
        case 'pass-with-warnings':
            return `${counts.OK} ${plural(counts.OK, 'check')} passed, with ${counts.WARNING} ${plural(counts.WARNING, 'warning')}; no errors were found.`
        case 'pass':
            return `${counts.OK} ${plural(counts.OK, 'check')} passed across ${sectionsTotal} ${plural(sectionsTotal, 'section')}; no errors or warnings were found.`
    }
}

/**
 * The collapsed one-line summary for a non-failed, non-skipped section, e.g. "6 checks passed,
 * 1 warning." A count is only stated when non-zero, so a section with nothing to report does not
 * claim "0 checks passed".
 */
export function sectionSummaryLine(section: ReportSection): string {
    const okCount = section.findings.filter((finding) => finding.severity === 'OK').length
    const warningCount = section.findings.filter((finding) => finding.severity === 'WARNING').length
    const errorCount = section.findings.filter((finding) => finding.severity === 'ERROR').length
    const infoCount = section.findings.filter((finding) => finding.severity === 'INFO').length

    const parts: string[] = []
    if (okCount > 0) parts.push(`${okCount} ${plural(okCount, 'check')} passed`)
    if (errorCount > 0) parts.push(`${errorCount} ${plural(errorCount, 'error')}`)
    if (warningCount > 0) parts.push(`${warningCount} ${plural(warningCount, 'warning')}`)
    if (infoCount > 0) parts.push(`${infoCount} info`)

    if (parts.length === 0) return 'No checks recorded.'

    return `${parts.join(', ')}.`
}

export type SeverityFilterValue = 'all' | 'error' | 'warning' | 'nottested'

const SEVERITY_FILTER_VALUES: readonly SeverityFilterValue[] = ['all', 'error', 'warning', 'nottested']

/** Anything unrecognised (missing param, typo, stale link) falls back to `all`. */
export function parseSeverityFilter(raw: string | undefined): SeverityFilterValue {
    return (SEVERITY_FILTER_VALUES as readonly string[]).includes(raw ?? '')
        ? (raw as SeverityFilterValue)
        : 'all'
}

export type SeverityFilterCounts = {
    error: number
    warning: number
    nottested: number
}

/** Counts shown on the filter pills, computed from the same summary the page already renders. */
export function severityFilterCounts(summary: ReportSummary): SeverityFilterCounts {
    return {
        error: summary.counts.ERROR,
        warning: summary.counts.ERROR + summary.counts.WARNING,
        nottested: summary.sectionsSkipped,
    }
}

const SEVERITIES_BY_FILTER: Record<Exclude<SeverityFilterValue, 'all' | 'nottested'>, readonly Severity[]> = {
    error: ['ERROR'],
    warning: ['ERROR', 'WARNING'],
}

/**
 * Applies the active severity filter to one section: hides non-matching findings, then hides the
 * section entirely if none remain — except that `nottested` matches a section's own `skipped`
 * status directly, so a skipped section (which has no findings) still passes that filter.
 */
export function filterSection(section: ReportSection, filter: SeverityFilterValue): ReportSection | null {
    if (filter === 'all') return section

    if (filter === 'nottested') return section.status === 'skipped' ? section : null

    const allowedSeverities = SEVERITIES_BY_FILTER[filter]
    const findings = section.findings.filter((finding) => allowedSeverities.includes(finding.severity))

    return findings.length > 0 ? { ...section, findings } : null
}
