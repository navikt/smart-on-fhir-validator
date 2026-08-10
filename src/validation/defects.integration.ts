/**
 * Defect-driven proof that this validator actually validates, rather than just returning green.
 *
 * Each misbehaviour in `src/mocks/defects.ts` is injected into the mock EHR and a full launch is
 * driven through this app's own SMART client. Each defect must either fail the launch/callback
 * outright (correct when this app's client hard-requires the broken field) or produce a specific
 * finding from `runValidation`. A conformant server must produce zero ERROR findings — false
 * positives train people to ignore the report, false negatives mean nothing is validated.
 *
 * Coverage gaps (defect present, launch completes, no finding) are named explicitly below rather
 * than hidden behind a passing suite.
 */
/* oxlint-disable vitest/expect-expect --
 * Nearly every test asserts through `expectFinding`, which throws its own detailed error rather
 * than calling a bare `expect(...)`. The rule cannot see assertions inside a called function.
 */
import { describe, expect, it } from 'vitest'

import { runValidation } from '#core/run/engine'
import type { ReportFinding, ReportSection, ValidationReport } from '#core/run/report'
import type { Defect } from '#mocks/server'
import { launchAgainstMockEhr, requireSuccessfulLaunch } from '#test/mock-ehr'

/** A fixed clock: this suite asserts on findings and stages, never on wall-clock timestamps. */
const FIXED_NOW = () => new Date('2025-06-01T12:00:00.000Z')

async function runReportWithDefects(defects: Defect[]): Promise<ValidationReport> {
    const { session, httpClient, recorder } = await requireSuccessfulLaunch({ defects })
    return runValidation(session, { httpClient, recorder, now: FIXED_NOW })
}

function allFindings(report: ValidationReport): ReportFinding[] {
    return report.sections.flatMap((s) => s.findings)
}

function findingsOf(report: ValidationReport, severity: ReportFinding['severity']): ReportFinding[] {
    return allFindings(report).filter((finding) => finding.severity === severity)
}

function section(report: ValidationReport, id: string): ReportSection | undefined {
    return report.sections.find((candidate) => candidate.id === id)
}

/** Asserts some finding in `sectionId` (or, if omitted, anywhere in the report) contains `substring`. */
function expectFinding(
    report: ValidationReport,
    severity: ReportFinding['severity'],
    substring: string,
    sectionId?: string,
): void {
    const findings = sectionId ? (section(report, sectionId)?.findings ?? []) : allFindings(report)
    const matching = findings.filter((f) => f.severity === severity && f.message.includes(substring))
    if (matching.length === 0) {
        throw new Error(
            `Expected a ${severity} finding${sectionId ? ` in section "${sectionId}"` : ''} containing ` +
                `${JSON.stringify(substring)}, but found: ${JSON.stringify(
                    findings.map((f) => `[${f.severity}] ${f.message}`),
                    null,
                    2,
                )}`,
        )
    }
    expect(matching.length).toBeGreaterThan(0)
}

describe('baseline: the fully conformant mock (no defects injected)', () => {
    it('produces no ERROR findings', async () => {
        const report = await runReportWithDefects([])
        const errorMessages = findingsOf(report, 'ERROR').map((f) => f.message)

        expect(errorMessages).toHaveLength(0)
    })

    it('is not itself a launch/callback failure', async () => {
        const outcome = await launchAgainstMockEhr({})
        expect(outcome.ok).toBe(true)
    })
})

describe('defects that break the launch or callback itself, before any report can be produced', () => {
    // These defects remove something this app's own SMART client hard-requires, so there is no
    // `ValidationReport` to inspect: the failure itself *is* the evidence the defect was noticed.

    it('well-known-404: launch fails when the well-known document 404s', async () => {
        // Deliberately duplicates the equivalent case in `launch-flow.integration.ts`, so this
        // file alone stays a complete map of every defect.
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-404'] })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('launch')
    })

    it('well-known-not-json: launch fails when the well-known endpoint returns a non-JSON body', async () => {
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-not-json'] })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('launch')
        expect(outcome.error.error).toContain('did not return a JSON document')
    })

    it('well-known-missing-required-fields: launch fails without an authorization_endpoint', async () => {
        // This defect deletes `authorization_endpoint`, `token_endpoint`, `grant_types_supported`
        // and `capabilities` together; the launch fails on the first one it needs, so the other
        // three REQUIRED-field ERRORs are only observable in `well-known.test.ts`.
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-missing-required-fields'] })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('launch')
        expect(outcome.error.error).toBe('missing_authorization_endpoint')
    })

    it('well-known-relative-urls: the authorize redirect 404s because the resolved URL drops the FHIR base path', async () => {
        // The mock strips the whole `baseUrl` including its `/fhir` path, leaving root-relative
        // paths. `resolveEndpoint` resolves those against the origin per RFC 3986 §5, which is
        // correct but lands off the FHIR base — an artefact of this defect, not an app bug. The
        // "relative URL" ERROR is unit-tested in `well-known.test.ts`; here we only prove broken
        // endpoint URLs break the live launch, which is the correct loud outcome.
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-relative-urls'] })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('authorize')
    })

    it('token-response-missing-scope: callback fails because `scope` is RFC 6749-required', async () => {
        // `handleCallback`'s schema requires `scope`, so the response is rejected before a session
        // exists — `token-response.ts`'s own "`scope` is missing" ERROR is unreachable via a live
        // launch and is unit-tested in `token-response.test.ts` instead.
        const outcome = await launchAgainstMockEhr({ defects: ['token-response-missing-scope'] })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('callback')
        expect(outcome.error.error).toBe('invalid_token_response')
        expect(outcome.error.detail).toContain('scope')
    })
})

describe('SMART discovery defects (src/mocks/auth/well-known.ts)', () => {
    it('well-known-missing-code-challenge-methods: discovery ERRORs on the missing field', async () => {
        const report = await runReportWithDefects(['well-known-missing-code-challenge-methods'])
        expectFinding(
            report,
            'ERROR',
            '`code_challenge_methods_supported` is missing from the well-known SMART configuration document',
            'discovery',
        )
    })

    it('well-known-allows-plain-pkce: discovery ERRORs because `plain` SHALL NOT be supported', async () => {
        const report = await runReportWithDefects(['well-known-allows-plain-pkce'])
        expectFinding(
            report,
            'ERROR',
            '`code_challenge_methods_supported` includes `plain`, which SHALL NOT be supported',
            'discovery',
        )
    })

    it('no-sso-openid-connect: token-response ERRORs on the missing id_token', async () => {
        // Removing `sso-openid-connect` also removes `issuer`/`jwks_uri` and the `id_token`. Those
        // fields are only CONDITIONALLY required, so `discovery` does not ERROR — the observable
        // failure is that an identity scope was requested but no `id_token` came back.
        const report = await runReportWithDefects(['no-sso-openid-connect'])
        expectFinding(
            report,
            'ERROR',
            '`id_token` is missing from the token response, even though `openid` plus `fhirUser`',
            'token-response',
        )
        // And, as a direct consequence, there is no id_token evidence to inspect at all.
        expect(section(report, 'id-token')?.status).toBe('skipped')
    })
})

describe('token response defects (src/mocks/auth/token.ts)', () => {
    it('token-response-missing-patient-context: token-response ERRORs and read probes lose their patient', async () => {
        const report = await runReportWithDefects(['token-response-missing-patient-context'])
        expectFinding(
            report,
            'ERROR',
            '`patient` is missing from the token response, even though a `launch` or `launch/patient` scope was requested',
            'token-response',
        )
        expectFinding(report, 'WARNING', 'No `patient` is available in launch context', 'launch-context')
    })

    it('token-response-missing-encounter-context: token-response WARNs (Nav-specific, not a SMART requirement)', async () => {
        const report = await runReportWithDefects(['token-response-missing-encounter-context'])
        expectFinding(
            report,
            'WARNING',
            '`encounter` is missing from the token response for an EHR launch',
            'token-response',
        )
    })

    it('token-response-narrows-scopes: scopes WARNs that a requested scope was not granted at all', async () => {
        // The mock drops the entire last requested scope rather than narrowing its CRUDS letters,
        // so `diffScopes` reports `not-granted`. That scope is not in `NAV_REQUIRED_SCOPES`, so
        // the finding is a WARNING rather than an ERROR.
        const report = await runReportWithDefects(['token-response-narrows-scopes'])
        expectFinding(
            report,
            'WARNING',
            'Scope `patient/QuestionnaireResponse.cruds` was requested but was not granted at all',
            'scopes',
        )
    })

    it('no-refresh-token: token-response WARNs since offline_access was requested', async () => {
        const report = await runReportWithDefects(['no-refresh-token'])
        expectFinding(
            report,
            'WARNING',
            '`refresh_token` is missing from the token response, even though `offline_access`',
            'token-response',
        )
    })
})

describe('id_token defects (src/mocks/auth/token.ts, signIdToken)', () => {
    it('id-token-missing-fhir-user: id-token ERRORs because an identity scope was requested', async () => {
        const report = await runReportWithDefects(['id-token-missing-fhir-user'])
        expectFinding(
            report,
            'ERROR',
            'The id_token has neither a `fhirUser` nor a `profile` claim',
            'id-token',
        )
    })

    it('id-token-wrong-audience: id-token ERRORs on jose signature verification failure', async () => {
        const report = await runReportWithDefects(['id-token-wrong-audience'])
        expectFinding(
            report,
            'ERROR',
            'The id_token failed verification: ERR_JWT_CLAIM_VALIDATION_FAILED',
            'id-token',
        )
    })

    it('id-token-expired: id-token ERRORs on jose expiry verification failure', async () => {
        const report = await runReportWithDefects(['id-token-expired'])
        expectFinding(report, 'ERROR', 'The id_token failed verification: ERR_JWT_EXPIRED', 'id-token')
    })
})

describe('FHIR capability-statement / version defects (src/mocks/fhir/metadata.ts)', () => {
    it('fhir-version-r4b: capability-statement ERRORs, Nav requires R4', async () => {
        const report = await runReportWithDefects(['fhir-version-r4b'])
        expectFinding(
            report,
            'ERROR',
            'The server declares FHIR version `4.3.0` (R4B), not R4',
            'capability-statement',
        )
    })

    it('fhir-version-r5: capability-statement ERRORs, Nav requires R4', async () => {
        const report = await runReportWithDefects(['fhir-version-r5'])
        expectFinding(
            report,
            'ERROR',
            'The server declares FHIR version `5.0.0` (R5), not R4',
            'capability-statement',
        )
    })
})

describe('FHIR read-resource defects (src/mocks/data/*.ts)', () => {
    it('patient-missing-identifier: Patient probe ERRORs on no fnr/D-number identifier', async () => {
        const report = await runReportWithDefects(['patient-missing-identifier'])
        expectFinding(
            report,
            'ERROR',
            'has no identifier from the Norwegian national identity number system',
            'patient',
        )
    })

    it('patient-wrong-identifier-system: Patient probe ERRORs identically (wrong system == no recognised identifier)', async () => {
        const report = await runReportWithDefects(['patient-wrong-identifier-system'])
        expectFinding(
            report,
            'ERROR',
            'has no identifier from the Norwegian national identity number system',
            'patient',
        )
    })

    it('practitioner-missing-hpr: Practitioner probe ERRORs on no HPR identifier', async () => {
        const report = await runReportWithDefects(['practitioner-missing-hpr'])
        expectFinding(
            report,
            'ERROR',
            'has no identifier from the Norwegian Health Personnel Register (HPR) system',
            'practitioner',
        )
    })

    it('organization-missing-orgnr: Organization probe ERRORs on no organisasjonsnummer identifier', async () => {
        const report = await runReportWithDefects(['organization-missing-orgnr'])
        expectFinding(
            report,
            'ERROR',
            'has no identifier from the organisasjonsnummer/ENH system',
            'organization',
        )
    })

    it('encounter-missing-class: Encounter probe WARNs (FHIR R4 requires it, Nav does not use it)', async () => {
        const report = await runReportWithDefects(['encounter-missing-class'])
        expectFinding(report, 'WARNING', 'has no `class`; FHIR R4 requires it', 'encounter')
    })

    it('encounter-missing-service-provider: Encounter probe ERRORs, Nav needs the organisation', async () => {
        const report = await runReportWithDefects(['encounter-missing-service-provider'])
        expectFinding(
            report,
            'ERROR',
            'has no `serviceProvider` reference; Nav needs it to identify the sykmelder',
            'encounter',
        )
    })

    it('condition-missing-code-system: Condition probe ERRORs on no recognised diagnosis code system', async () => {
        const report = await runReportWithDefects(['condition-missing-code-system'])
        expectFinding(report, 'ERROR', 'has no entry whose `system` is ICD-10', 'condition')
    })
})

describe('FHIR write-resource defects (src/mocks/fhir/*.ts)', () => {
    it('document-reference-search-unsupported: the DocumentReference write probe ERRORs when it cannot search by subject', async () => {
        const report = await runReportWithDefects(['document-reference-search-unsupported'])
        expectFinding(
            report,
            'ERROR',
            'A written DocumentReference must be findable by "subject"',
            'document-reference-write-inline',
        )
    })

    it('document-reference-rejects-binary: the Binary-reference write probe ERRORs on the rejected PUT', async () => {
        const report = await runReportWithDefects(['document-reference-rejects-binary'])
        expectFinding(
            report,
            'ERROR',
            'failed to upsert the DocumentReference with status 422',
            'document-reference-write-binary',
        )
    })

    it('questionnaire-response-unsupported: the QuestionnaireResponse write probe ERRORs on the rejected PUT', async () => {
        const report = await runReportWithDefects(['questionnaire-response-unsupported'])
        expectFinding(
            report,
            'ERROR',
            'failed to upsert the QuestionnaireResponse with status 404',
            'questionnaire-response-write',
        )
    })

    it('bundle-transaction-only: the batch Bundle write probe ERRORs when the server rejects "batch"', async () => {
        const report = await runReportWithDefects(['bundle-transaction-only'])
        expectFinding(
            report,
            'ERROR',
            'This server only accepts transaction Bundles, not batch',
            'bundle-batch-write',
        )
    })
})

describe('authorize endpoint defects (src/mocks/auth/authorize.ts)', () => {
    it('aud-not-validated: the aud-enforcement probe ERRORs on a server that does not enforce aud', async () => {
        // `aud-not-validated` disables the mock's own check that the authorize request's `aud`
        // equals its FHIR base URL. This app always sends the correct `aud`, so the finding comes
        // entirely from the dedicated `aud-enforcement` probe, which sends a wrong `aud` on a
        // separate request.
        const report = await runReportWithDefects(['aud-not-validated'])
        expectFinding(
            report,
            'ERROR',
            'did NOT reject an authorization request whose `aud` parameter deliberately did not match',
            'aud-enforcement',
        )
    })

    it('a conformant server (no defects) is reported as correctly enforcing aud', async () => {
        const report = await runReportWithDefects([])
        expectFinding(
            report,
            'OK',
            'rejected an authorization request whose `aud` parameter deliberately did not match',
            'aud-enforcement',
        )
    })
})
