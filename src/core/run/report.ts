/**
 * The report data model produced by the run engine (`engine.ts`).
 *
 * A `ValidationReport` is the single serialisable artefact the UI renders: every finding a
 * validator produced, grouped into sections, paired with the raw `HttpExchange` that produced
 * it (via `exchangeId`) and a spec citation (`refs`), plus a summary the UI can render without
 * re-deriving anything from the sections.
 */

import type { HttpExchange } from '#core/http/exchange'
import type { ProbeOutcome } from '#validation/fhir/probe'
import type { RefTypes } from '#validation/common-refs'
import type { SmartError } from '#core/smart/types'
import type { Severity, Validation } from '#validation/validation'

/** Groups sections for the UI without encoding an opinion about SMART vs FHIR vs Nav — that
 * distinction lives per-finding in `refs`, since a single section can mix all three. */
export type SectionCategory = 'smart' | 'fhir-conformance' | 'fhir-read' | 'fhir-write'

/**
 * `skipped` is deliberately its own status, never folded into `passed`: a probe that could not
 * run (e.g. no `patient` in launch context) proves nothing either way, so it must never read as
 * a pass in the UI or in the overall verdict.
 */
export type SectionStatus = 'passed' | 'warned' | 'failed' | 'skipped'

export type ReportFinding = {
    /** Stable within a report, used as a React list key. Not meaningful across report runs. */
    id: string
    message: string
    severity: Severity
    refs?: RefTypes
    /** The `HttpExchange` that produced this finding, so the UI can show the raw request/response. */
    exchangeId: string | null
}

export type ReportSection = {
    id: string
    title: string
    category: SectionCategory
    status: SectionStatus
    /** Explains a `skipped` status, or gives context for a fetch that failed outright. */
    description?: string
    findings: ReportFinding[]
}

export type Verdict = 'pass' | 'pass-with-warnings' | 'fail' | 'skipped'

export type ReportSummary = {
    counts: Record<Severity, number>
    sectionsSkipped: number
    verdict: Verdict
}

export type ValidationReport = {
    generatedAt: string
    issuer: string
    fhirBaseUrl: string
    clientId: string
    sections: ReportSection[]
    exchanges: HttpExchange[]
    summary: ReportSummary
}

function severityOf(findings: readonly ReportFinding[]): 'failed' | 'warned' | 'passed' {
    if (findings.some((finding) => finding.severity === 'ERROR')) return 'failed'
    if (findings.some((finding) => finding.severity === 'WARNING')) return 'warned'
    return 'passed'
}

function toFindings(
    sectionId: string,
    exchangeId: string | null,
    validations: readonly Validation[],
): ReportFinding[] {
    return validations.map((entry, index) => ({
        id: `${sectionId}-${index}`,
        message: entry.message,
        severity: entry.severity,
        refs: entry.refs,
        exchangeId,
    }))
}

export type BuildSectionInput = {
    id: string
    title: string
    category: SectionCategory
    exchangeId: string | null
    validations: readonly Validation[]
}

/** The normal case: a phase ran to completion and produced zero or more findings. */
export function buildSection(input: BuildSectionInput): ReportSection {
    const findings = toFindings(input.id, input.exchangeId, input.validations)

    return {
        id: input.id,
        title: input.title,
        category: input.category,
        status: severityOf(findings),
        findings,
    }
}

export type SkippedSectionInput = {
    id: string
    title: string
    category: SectionCategory
    reason: string
}

/** A phase that could not run at all — never a failure, just an absence of evidence. */
export function skippedSection(input: SkippedSectionInput): ReportSection {
    return {
        id: input.id,
        title: input.title,
        category: input.category,
        status: 'skipped',
        description: input.reason,
        findings: [],
    }
}

export type ErrorSectionInput = {
    id: string
    title: string
    category: SectionCategory
    error: SmartError
}

/** A phase whose own HTTP call failed outright (transport error or non-2xx) — a real failure. */
export function errorSection(input: ErrorSectionInput): ReportSection {
    const { error } = input
    const message = error.detail ? `${error.error}: ${error.detail}` : error.error

    return {
        id: input.id,
        title: input.title,
        category: input.category,
        status: 'failed',
        findings: [
            {
                id: `${input.id}-fetch-error`,
                message,
                severity: 'ERROR',
                exchangeId: error.exchangeId ?? null,
            },
        ],
    }
}

/** Turns a `ProbeOutcome` (from `#validation/fhir/probe`) into a `ReportSection`. */
export function sectionFromProbeOutcome(outcome: ProbeOutcome, category: SectionCategory): ReportSection {
    if (outcome.skipped) {
        return skippedSection({
            id: outcome.probeId,
            title: outcome.label,
            category,
            reason: outcome.skipped.reason,
        })
    }

    return buildSection({
        id: outcome.probeId,
        title: outcome.label,
        category,
        exchangeId: outcome.exchangeId,
        validations: outcome.validations,
    })
}

/**
 * A run with any skipped section is never reported as a plain pass: a probe that could not run
 * proves nothing about the resource it targets, so treating it as a pass would overstate what
 * was actually verified. Precedence is fail > skipped > warnings > pass — a run that both failed
 * and skipped something is reported as a failure, since that is the more actionable signal.
 */
export function summarize(sections: readonly ReportSection[]): ReportSummary {
    const counts: Record<Severity, number> = { OK: 0, INFO: 0, WARNING: 0, ERROR: 0 }
    for (const section of sections) {
        for (const finding of section.findings) counts[finding.severity] += 1
    }

    const sectionsSkipped = sections.filter((section) => section.status === 'skipped').length
    const hasFailed = sections.some((section) => section.status === 'failed')
    const hasWarned = sections.some((section) => section.status === 'warned')

    const verdict: Verdict = hasFailed
        ? 'fail'
        : sectionsSkipped > 0
          ? 'skipped'
          : hasWarned
            ? 'pass-with-warnings'
            : 'pass'

    return { counts, sectionsSkipped, verdict }
}
