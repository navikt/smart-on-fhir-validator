import type { OperationOutcome } from 'fhir/r4'

/** The subset of the HL7 `IssueType` value set this mock has occasion to return. */
export type IssueCode =
    | 'invalid'
    | 'security'
    | 'not-found'
    | 'not-supported'
    | 'required'
    | 'value'
    | 'forbidden'
    | 'processing'

export function operationOutcome(
    severity: 'error' | 'warning' | 'information',
    code: IssueCode,
    diagnostics: string,
): OperationOutcome {
    return {
        resourceType: 'OperationOutcome',
        issue: [{ severity, code, diagnostics }],
    }
}
