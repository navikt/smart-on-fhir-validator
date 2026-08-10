/**
 * Turns a completed SMART launch (`ActiveSession`) into a serialisable `ValidationReport`.
 *
 * Phases run in a fixed order — discovery, capability statement, `aud` enforcement, token
 * response, id_token, scopes, launch context, read probes, write probes — so the report reads
 * earliest-lifecycle evidence first. A failing phase never stops the run: every error path
 * becomes a finding or an `errorSection`/`skippedSection`, so EHR misbehaviour can only fill the
 * report with ERROR findings, never crash it.
 */

import { FhirClient } from '#core/fhir/client'
import type { ExchangeRecorder } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'
import type { ActiveSession } from '#core/smart/types'
import { validation } from '#validation/validation'

import { runAudEnforcementPhase } from './phases/aud-enforcement'
import { runCapabilityStatementPhase } from './phases/capability-statement'
import { runDiscoveryPhase } from './phases/discovery'
import { runIdTokenPhase } from './phases/id-token'
import { runLaunchContextPhase } from './phases/launch-context'
import { runReadProbesPhase, runWriteProbesPhase } from './phases/probes'
import { runScopesPhase } from './phases/scopes'
import { runTokenResponsePhase } from './phases/token-response'
import { buildSection, summarize, type ReportSection, type ValidationReport } from './report'

export type RunValidationDependencies = {
    httpClient: SmartHttpClient
    /**
     * The exact recorder wired into `httpClient`, seeded with the session's launch/callback
     * exchanges so the evidence trail covers the whole lifecycle, not just this run.
     */
    recorder: ExchangeRecorder
    now?: () => Date
}

async function runPhases(session: ActiveSession, deps: RunValidationDependencies): Promise<ReportSection[]> {
    const sections: ReportSection[] = []

    const discovery = await runDiscoveryPhase(session, deps.httpClient)
    sections.push(...discovery.sections)

    sections.push(await runCapabilityStatementPhase(session, deps.httpClient))

    sections.push(await runAudEnforcementPhase(session, discovery.smartConfiguration, deps.httpClient))

    sections.push(runTokenResponsePhase(session))

    sections.push(
        await runIdTokenPhase(session, discovery.smartConfiguration, deps.httpClient, deps.recorder),
    )

    sections.push(runScopesPhase(session, discovery.smartConfiguration))

    const { launchContext, section: launchContextSection } = runLaunchContextPhase(session)
    sections.push(launchContextSection)

    const fhir = new FhirClient({
        http: deps.httpClient,
        baseUrl: session.fhirBaseUrl,
        accessToken: session.tokenResponse.access_token,
    })

    sections.push(...(await runReadProbesPhase(fhir, launchContext)))
    sections.push(...(await runWriteProbesPhase(fhir, launchContext)))

    return sections
}

function fatalSection(cause: unknown): ReportSection {
    const message = cause instanceof Error ? cause.message : String(cause)

    return buildSection({
        id: 'fatal',
        title: 'Validation run',
        category: 'smart',
        exchangeId: null,
        validations: [
            validation(
                `The validation run itself failed unexpectedly: ${message}. This is a bug in the ` +
                    'validator, not necessarily a problem with the EHR. Please report it.',
                'ERROR',
            ),
        ],
    })
}

/**
 * Phases never throw on their own (HTTP failures and non-conformance become findings); the
 * top-level catch is a safety net for a bug in the engine itself, so even that still yields a
 * report rather than an unhandled exception.
 */
export async function runValidation(
    session: ActiveSession,
    deps: RunValidationDependencies,
): Promise<ValidationReport> {
    const now = deps.now ?? (() => new Date())
    let sections: ReportSection[]

    try {
        sections = await runPhases(session, deps)
    } catch (cause) {
        sections = [fatalSection(cause)]
    }

    return {
        generatedAt: now().toISOString(),
        issuer: session.issuer,
        fhirBaseUrl: session.fhirBaseUrl,
        clientId: session.clientId,
        sections,
        exchanges: [...deps.recorder.all()],
        summary: summarize(sections),
    }
}
