/**
 * The run engine: takes a completed SMART launch (`ActiveSession`) and produces a complete,
 * serialisable `ValidationReport` by running every validator this repository has against real
 * evidence collected from the EHR.
 *
 * Phases run in a fixed order — discovery, capability statement, token response, id_token,
 * scopes, launch context, read probes, write probes — mirroring the order a vendor would
 * naturally want to read a report in: earliest-lifecycle evidence first. A failing phase never
 * stops the run; every error path is captured as a finding or an `errorSection`/`skippedSection`,
 * so the worst an EHR's misbehaviour can do is fill the report with ERROR findings, never crash it.
 */

import { FhirClient } from '#core/fhir/client'
import type { ExchangeRecorder } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'
import type { ActiveSession } from '#core/smart/types'
import { validation } from '#validation/validation'

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
     * The exact recorder wired into `httpClient`, seeded with the session's own launch/callback
     * exchanges so the final report's evidence trail covers the whole lifecycle, not just this run.
     */
    recorder: ExchangeRecorder
    now?: () => Date
}

async function runPhases(session: ActiveSession, deps: RunValidationDependencies): Promise<ReportSection[]> {
    const sections: ReportSection[] = []

    const discovery = await runDiscoveryPhase(session, deps.httpClient)
    sections.push(...discovery.sections)

    sections.push(await runCapabilityStatementPhase(session, deps.httpClient))

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

/** A single section reporting that the run engine itself failed unexpectedly (see `runValidation`). */
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
                    'validator, not necessarily a problem with the EHR — please report it.',
                'ERROR',
            ),
        ],
    })
}

/**
 * Runs every validation phase against `session` and returns a complete `ValidationReport`.
 *
 * Every individual phase is already designed not to throw (HTTP failures and non-conformant
 * responses become findings). The top-level `try`/`catch` here is a last-resort safety net for
 * a genuinely unexpected bug in the run engine itself, so that even *that* still produces a
 * report — with everything collected so far — rather than an unhandled exception reaching the
 * caller.
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
