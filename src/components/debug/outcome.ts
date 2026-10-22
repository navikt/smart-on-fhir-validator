import type { HttpExchange } from '#core/http/exchange'

export type ResponseSummary = {
    bundle: { total: number | null; entries: number } | null
    issues: { severity: string; code: string; text: string }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issueText(issue: Record<string, unknown>): string {
    const details =
        isRecord(issue.details) && typeof issue.details.text === 'string' ? issue.details.text : ''
    const diagnostics = typeof issue.diagnostics === 'string' ? issue.diagnostics : ''

    return [details, diagnostics].filter((part) => part !== '').join(': ')
}

export function summarizeResponse(exchange: HttpExchange): ResponseSummary {
    const body = exchange.response?.body
    const summary: ResponseSummary = { bundle: null, issues: [] }
    if (!isRecord(body)) return summary

    if (body.resourceType === 'Bundle') {
        summary.bundle = {
            total: typeof body.total === 'number' ? body.total : null,
            entries: Array.isArray(body.entry) ? body.entry.length : 0,
        }
    }

    if (body.resourceType === 'OperationOutcome' && Array.isArray(body.issue)) {
        summary.issues = body.issue.filter(isRecord).map((issue) => ({
            severity: typeof issue.severity === 'string' ? issue.severity : 'unknown',
            code: typeof issue.code === 'string' ? issue.code : 'unknown',
            text: issueText(issue),
        }))
    }

    return summary
}
