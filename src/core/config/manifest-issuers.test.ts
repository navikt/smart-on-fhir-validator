/**
 * Validates the `SMART_ISSUERS` value actually committed to `.nais/nais-dev.yaml` against the same
 * schema the app parses at startup.
 *
 * This exists because `SMART_ISSUERS` is contributed by outside EHR vendors through pull requests
 * (see README, "Register your EHR"). CI never sets `SMART_ISSUERS`, so `loadIssuers()` silently
 * returns `[]` in every other test: a malformed entry would pass the whole pipeline green and then
 * crash pod startup on merge, with no pre-merge warning. Running here means a bad entry fails the
 * contributor's own PR.
 *
 * It lives in the test suite rather than a standalone CI step on purpose: `yarn test:coverage`
 * already runs inside the required "Lint, typecheck and test" check, so this blocks a merge without
 * adding a new status check (which would need the branch ruleset updated to actually be enforced).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import type { parseIssuerEntries as ParseIssuerEntries } from './issuers'

const MANIFEST_PATH = join(process.cwd(), '.nais', 'nais-dev.yaml')
const ENV_NAME = 'SMART_ISSUERS'

/**
 * Matches a nais/Go template placeholder such as `{{ image }}`, which the deploy action substitutes
 * before the manifest is ever parsed as YAML. Left in place the file is not valid YAML on its own
 * (`image: {{ image }}` reads as a mapping used as a key).
 *
 * Deliberately narrow: it matches a bare identifier between the braces, so it cannot rewrite
 * arbitrary text that happens to contain braces inside a vendor's own JSON value.
 */
const TEMPLATE_PLACEHOLDER = /\{\{\s*[a-zA-Z_][\w.]*\s*\}\}/g

function parseManifest(source: string): unknown {
    return parse(source.replace(TEMPLATE_PLACEHOLDER, 'template-placeholder'))
}

/**
 * Returns the value of the one `spec.env` entry named `name`, throwing on anything ambiguous.
 *
 * Requiring *exactly* one match is the point. A pod resolves duplicate environment names by taking
 * the last one, so reading the first would let a pull request append a second `SMART_ISSUERS` entry
 * whose value this check never looks at while the running pod uses it. Every other failure mode
 * here (key renamed, moved into a secret, nested differently, given a non-string value) also throws
 * rather than returning nothing, because silently finding no value would make the schema assertion
 * below vacuous and hand back false confidence.
 */
function readSoleEnvValue(manifest: unknown, name: string): string {
    const env = (manifest as { spec?: { env?: unknown } } | null)?.spec?.env
    if (!Array.isArray(env)) {
        throw new Error(`.nais/nais-dev.yaml has no spec.env list to read ${name} from`)
    }

    const matches = env.filter((entry: unknown) => (entry as { name?: unknown })?.name === name)
    if (matches.length !== 1) {
        throw new Error(
            `.nais/nais-dev.yaml must declare exactly one ${name} entry in spec.env, found ${matches.length}.`,
        )
    }

    const value = (matches[0] as { value?: unknown }).value
    if (typeof value !== 'string') {
        throw new Error(`${name} in .nais/nais-dev.yaml must be a plain string value.`)
    }

    return value
}

/**
 * Returns every hostname listed under `spec.accessPolicy.outbound.external` (lower-cased, matching
 * `URL#hostname`), throwing on anything malformed rather than returning an empty set that would
 * make the egress cross-check below vacuously pass for the wrong reason.
 */
function readExternalHosts(manifest: unknown): Set<string> {
    const external = (manifest as { spec?: { accessPolicy?: { outbound?: { external?: unknown } } } } | null)
        ?.spec?.accessPolicy?.outbound?.external

    if (!Array.isArray(external)) {
        throw new Error(
            '.nais/nais-dev.yaml has no spec.accessPolicy.outbound.external list to read egress hosts from.',
        )
    }

    return new Set(
        external.map((entry: unknown, index) => {
            const host = (entry as { host?: unknown })?.host
            if (typeof host !== 'string' || host.length === 0) {
                throw new Error(
                    `.nais/nais-dev.yaml spec.accessPolicy.outbound.external[${index}] must have a ` +
                        `non-empty string host.`,
                )
            }
            return host.toLowerCase()
        }),
    )
}

describe('.nais/nais-dev.yaml: SMART_ISSUERS', () => {
    const manifest = parseManifest(readFileSync(MANIFEST_PATH, 'utf8'))

    let parseIssuerEntries: typeof ParseIssuerEntries

    beforeAll(async () => {
        // Importing ./issuers runs its module-level loadIssuers(). Clearing the variable first stops
        // a stray SMART_ISSUERS in a developer's shell from failing this test for an unrelated
        // reason. The type-only import above is erased, so it triggers nothing.
        delete process.env[ENV_NAME]
        ;({ parseIssuerEntries } = await import('./issuers'))
    })

    it('is declared exactly once as a plain env value, so a vendor can register by pull request', () => {
        expect(() => readSoleEnvValue(manifest, ENV_NAME)).not.toThrow()
    })

    it('parses under the same schema and constraints the app applies at startup', () => {
        const raw = readSoleEnvValue(manifest, ENV_NAME)

        // parseIssuerEntries covers the zod schema, the SMART_CLIENT_SECRET_<NAME> restriction on
        // clientSecretEnv, .strict() on every entry (so a pasted-in secret is rejected rather than
        // silently stripped), and both uniqueness checks. It reads no secret, so this passes in CI
        // without any deployment credential being available.
        expect(() => parseIssuerEntries(raw)).not.toThrow()
    })

    it(
        "lists every SMART_ISSUERS entry's FHIR base URL hostname under " +
            'spec.accessPolicy.outbound.external, so a vendor missing that PR-required addition fails ' +
            "here instead of failing at runtime with an egress-blocked connection error (see this " +
            "file's README reference above)",
        () => {
            const raw = readSoleEnvValue(manifest, ENV_NAME)
            const entries = parseIssuerEntries(raw)
            const externalHosts = readExternalHosts(manifest)

            // Only the FHIR base URL host is checked here: the authorization, token and JWKS hosts
            // are frequently on other hostnames entirely (see the accessPolicy comment in the
            // manifest itself) and can only be learned by actually running discovery against the
            // vendor, not by statically reading SMART_ISSUERS.
            const missingHosts = entries
                .map((entry) => ({ name: entry.name, hostname: new URL(entry.fhirBaseUrl).hostname }))
                .filter(({ hostname }) => !externalHosts.has(hostname))

            expect(missingHosts).toEqual([])
        },
    )
})
