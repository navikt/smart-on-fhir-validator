/**
 * Defect-driven proof that this validator actually validates, rather than just returning green.
 *
 * Every named misbehaviour in `src/mocks/defects.ts` (29 at last count) is injected into the
 * in-repo mock EHR, a full launch is driven through this app's own SMART client
 * (`#test/mock-ehr`'s `launchAgainstMockEhr`/`requireSuccessfulLaunch`), and either:
 *
 *  - the launch/callback fails outright with a `SmartError` (the correct behaviour when the
 *    defect breaks something this app's own client hard-requires to function at all — a missing
 *    `authorization_endpoint`, an unparseable well-known document, a token response missing a
 *    RFC 6749-required field); or
 *  - `runValidation` (the real run engine, `#core/run/engine`) is run against the completed
 *    session and produces the specific finding that defect must surface.
 *
 * Both directions matter, and this file is split accordingly:
 *
 *  1. "no defects injected" must produce zero ERROR findings that this suite doesn't already
 *     know about and name explicitly (see `KNOWN_BASELINE_MOCK_BUGS` below) — a false positive
 *     from a fully conformant server is exactly the kind of noise that trains people to ignore
 *     the report.
 *  2. every individual defect must produce its expected ERROR/WARNING, or fail the launch in a
 *     way that is itself the correct, loud response to that non-conformance — a false negative
 *     (silently green) would mean the validator does not actually validate anything.
 *
 * Where neither happens — the defect exists, the launch completes, and no finding says
 * anything about it — that is a genuine coverage gap in the product. This suite does not paper
 * over such gaps: any that exists is named explicitly, with the reasoning for why, so it is
 * visible rather than hidden by a passing test suite (see e.g. the `aud-not-validated` history
 * in git blame for what that looked like before the `#core/run/phases/aud-enforcement` probe
 * closed it).
 */
/* oxlint-disable vitest/expect-expect --
 * Nearly every test below asserts through `expectFinding`, a helper that throws its own detailed
 * error (see below) rather than calling a bare `expect(...)` in the test body. The rule cannot see
 * assertions made inside a called function, so it flags every one of these tests as having "no
 * assertions" even though a failing `expectFinding` call fails the test exactly as a direct
 * `expect` would, with a more useful message naming the missing finding.
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

/**
 * Pre-existing bugs in `src/mocks/**` (not owned by this test suite — see the task's ownership
 * rules) that make even the *fully conformant* mock EHR (zero defects injected) produce ERROR
 * findings. Each is verified against source below; none is caused by, or related to, any defect
 * this file injects. They are named here — rather than fixed, papered over, or silently
 * tolerated — so:
 *
 *  - a NEW, unrelated regression (e.g. from a dependency bump) that adds a further baseline
 *    ERROR still fails this test loudly;
 *  - if one of these bugs is fixed later, this test's exact-count assertion fails too, forcing
 *    whoever fixed it to notice and shrink this list — it cannot silently go stale.
 *
 * 1. `PractitionerRole` never sets `meta.profile` (`src/mocks/data/practitioner-role.ts`),
 *    unlike every other no-basis-* resource in this mock — an unconditional omission, not
 *    gated behind any `Defect`. `validatePractitionerRoleResource` correctly reports this as an
 *    ERROR; the mock is simply wrong, always, regardless of `defects`.
 * 2. `POST /Binary` with a raw (non-JSON) body — the `createBinaryRaw` upload mechanism
 *    `FhirClient` and `binaryWriteProbe` both exercise on purpose, per RFC — always 422s.
 *    `src/mocks/fhir/resource-router.ts`'s generic `onCreate` handler unconditionally calls
 *    `c.req.json()`; a raw PDF body isn't JSON, so the parse fails, `body` becomes `null`, and
 *    `validateBinary(null)` reports the resource as missing `contentType`/`data`. The mock's
 *    `binaryRouter` (`src/mocks/fhir/binary.ts`) never special-cases a non-FHIR-JSON
 *    `Content-Type`, so this mechanism can never succeed against this mock, defects or not.
 * 3. `GET /QuestionnaireResponse?encounter=...` always 400s: unlike `documentReferenceRouter`
 *    (which registers an `encounter` search-param matcher), `questionnaireResponseRouter`
 *    (`src/mocks/fhir/questionnaire-response.ts`) only registers `subject` and `questionnaire`.
 *    `write-probes.ts`'s `questionnaireResponseWriteProbe` searches by `encounter=` regardless
 *    (mirroring the DocumentReference probe), so this is a permanent, defect-independent 400.
 *
 * None of these are fixable from this suite's ownership (`src/mocks/**` and `src/validation/**`
 * both belong to other agents). They are reported prominently in the task summary as follow-up
 * work — see the final report.
 */
const KNOWN_BASELINE_MOCK_BUGS = [
    'PractitionerRole/practitioner-role-sidsel-jarvery does not declare `meta.profile`',
    'POST https://mock-ehr.example.com/fhir/Binary failed to create the Binary with status 422',
    'GET https://mock-ehr.example.com/fhir/QuestionnaireResponse?encounter=' +
        'Encounter%2Fencounter-espen-1 failed with status 400',
]

describe('baseline: the fully conformant mock (no defects injected)', () => {
    it('produces no ERROR findings beyond the known, out-of-scope mock bugs named above', async () => {
        const report = await runReportWithDefects([])
        const errorMessages = findingsOf(report, 'ERROR').map((f) => f.message)

        for (const message of errorMessages) {
            const isKnown = KNOWN_BASELINE_MOCK_BUGS.some((known) => message.includes(known))
            expect(
                isKnown,
                `Unexpected new baseline ERROR (not in KNOWN_BASELINE_MOCK_BUGS): ${message}`,
            ).toBe(true)
        }

        // Every known bug is still present — if this ever drops below 3, one of them was fixed
        // and this list (and its justifying comment) needs to shrink to match.
        expect(errorMessages).toHaveLength(KNOWN_BASELINE_MOCK_BUGS.length)
    })

    it('is not itself a launch/callback failure', async () => {
        const outcome = await launchAgainstMockEhr({})
        expect(outcome.ok).toBe(true)
    })
})

describe('defects that break the launch or callback itself, before any report can be produced', () => {
    // These defects remove something this app's own SMART client hard-requires to function —
    // proof the client actually depends on the field, rather than silently tolerating its
    // absence. There is no `ValidationReport` to inspect for any of these: the failure itself
    // *is* the evidence the defect was noticed.

    it('well-known-404: launch fails when the well-known document 404s', async () => {
        // Duplicates the equivalent case in `launch-flow.integration.ts` deliberately, so this
        // file alone is a complete map of all 29 defects without needing to cross-reference.
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
        // This one defect deletes `authorization_endpoint`, `token_endpoint`,
        // `grant_types_supported` and `capabilities` together (see `well-known.ts`); the launch
        // step fails on the first of those it needs (`authorization_endpoint`), so the other
        // three REQUIRED-field ERRORs (already unit-tested directly in `well-known.test.ts`)
        // can never be observed through a live launch with this defect alone.
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-missing-required-fields'] })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('launch')
        expect(outcome.error.error).toBe('missing_authorization_endpoint')
    })

    it('well-known-relative-urls: the authorize redirect 404s because the resolved URL drops the FHIR base path', async () => {
        // The mock strips the *entire* `baseUrl` (including its `/fhir` path segment) from each
        // endpoint URL, leaving root-relative paths like `/authorize`. This app's `resolveEndpoint`
        // (RFC1808 courtesy resolution) correctly resolves `/authorize` against the *origin*, per
        // spec — but that lands on `https://mock-ehr.example.com/authorize`, not
        // `.../fhir/authorize`, since a root-relative reference discards the base's path
        // entirely. That is a property of how this particular defect constructs its relative
        // URLs, not a bug in this app: a real EHR returning genuinely relative (non-rooted)
        // endpoint paths would resolve correctly. The ERROR this produces in `discovery`
        // ("relative URL") is already unit-tested directly against `validateSmartConfiguration`
        // in `well-known.test.ts`; here we only prove that a server advertising broken endpoint
        // URLs breaks the live launch, which is itself the correct, loud outcome.
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-relative-urls'] })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('authorize')
    })

    it('token-response-missing-scope: callback fails because `scope` is RFC 6749-required', async () => {
        // `handleCallback`'s own `tokenResponseSchema` (`#core/smart/callback.ts`) requires
        // `scope: z.string()`; a token response omitting it fails schema validation before a
        // session is ever created, so `token-response.ts`'s own "`scope` is missing" ERROR (unit
        // -tested directly in `token-response.test.ts`) can never be reached via a live launch
        // with this defect — the app rejects the malformed response even earlier than that.
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
        // Removing `sso-openid-connect` also removes `issuer`/`jwks_uri` from the well-known
        // document and stops the mock issuing an `id_token` at all. Since those fields are only
        // CONDITIONALLY required (when `sso-openid-connect` is advertised), `discovery` does not
        // ERROR on their absence — the observable failure is `token-response`'s: an identity
        // scope (`openid`+`fhirUser`) was requested but no `id_token` came back.
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
        // The mock drops the *entire last requested scope* rather than narrowing its CRUDS
        // letters, so `diffScopes` reports it as `not-granted` rather than `narrowed`.
        // `patient/QuestionnaireResponse.cruds` is last in `DEFAULT_SCOPE` and is not one of
        // Nav's `NAV_REQUIRED_SCOPES`, so the finding is a WARNING, not an ERROR.
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
        // `aud-not-validated` disables the mock's own enforcement that the authorize request's
        // `aud` equals its FHIR base URL (see `src/mocks/auth/authorize.ts`). This app's own
        // client (`#core/smart/launch.ts`) always sends the correct `aud`, so nothing about the
        // real launch itself changes when this defect is enabled — the finding below comes
        // entirely from the dedicated `aud-enforcement` diagnostic probe
        // (`#core/run/phases/aud-enforcement`), which deliberately sends a *wrong* `aud` on a
        // separate request and reports whether the server rejects it.
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
