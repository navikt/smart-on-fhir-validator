/**
 * Static, per-vendor client configuration: the primary way this app authenticates to an EHR's
 * token endpoint. Dynamic client registration (`registration.ts`) is the fallback for vendors
 * that support RFC 7591 and have no entry here.
 *
 * Read from the `SMART_ISSUERS` environment variable (a JSON array). This is our own
 * configuration, not EHR-supplied input, so a malformed value crashes at startup by design.
 *
 * `SMART_ISSUERS` is meant to be reviewable in a public pull request (see `.nais/nais-dev.yaml`,
 * not a secret): every field here is a name or a public identifier, never a secret value. Four
 * constraints keep that true even once entries are contributed by outside vendors:
 *
 * - `clientSecretEnv` must match `SMART_CLIENT_SECRET_<NAME>` (never an arbitrary variable name),
 *   so a PR-contributed entry cannot reference an unrelated secret such as `SMART_PRIVATE_JWK`.
 * - Every `clientSecretEnv` value must be unique across the whole array (`assertNoDuplicateClientSecretEnv`).
 *   Otherwise a new entry could deliberately name an existing vendor's already-provisioned secret
 *   and have this app hand that vendor's client secret to the new entry's own token endpoint.
 * - Every entry schema is `.strict()`. Without it zod silently *strips* unknown keys, so a vendor who
 *   pasted a real `"clientSecret"` into their entry would get a green CI run while the secret sat in
 *   public git history forever. Strict turns that mistake into a loud, pre-merge failure.
 * - `asymmetric` entries carry no env var at all: this app has exactly one signing identity,
 *   published as a whole at `.well-known/jwks.json` (`#core/smart/jwks`), so every `private_key_jwt`
 *   vendor necessarily uses that same key: there is no second private key to reference.
 *
 * The lookup key is `fhirBaseUrl`, this vendor's FHIR server base URL (the `iss` SMART launch
 * parameter), never an OIDC `issuer`. The field used to be named `issuer`, which was ambiguous
 * enough to cause a real bug: see `resolveIssuerConfig` in `#core/smart/launch` for why a vendor's
 * FHIR base URL, not their (possibly different-origin) OIDC issuer, is the only safe credential
 * lookup key.
 */

import * as z from 'zod'

import type { IssuerConfig } from '#core/smart/types'

/** This app's one signing identity, see `#core/smart/jwks`. Never issuer-configurable. */
const PRIVATE_KEY_ENV_VAR = 'SMART_PRIVATE_JWK'

const BaseEntrySchema = z.object({
    name: z.string().min(1),
    fhirBaseUrl: z.url(),
    clientId: z.string().min(1),
})

const PublicEntrySchema = BaseEntrySchema.extend({
    authType: z.literal('public'),
}).strict()

const SymmetricEntrySchema = BaseEntrySchema.extend({
    authType: z.literal('symmetric'),
    // RFC 6749 does not mandate a client auth method; 'client_secret_basic' is the traditional
    // default for confidential clients that do not otherwise negotiate one.
    method: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),
    /**
     * Name of the environment variable holding the secret, never the secret value itself, and
     * constrained to this prefix so a contributed entry cannot name an unrelated variable.
     */
    clientSecretEnv: z.string().regex(/^SMART_CLIENT_SECRET_[A-Z0-9_]+$/, {
        message: "clientSecretEnv must look like 'SMART_CLIENT_SECRET_<NAME>'",
    }),
}).strict()

const AsymmetricEntrySchema = BaseEntrySchema.extend({
    authType: z.literal('asymmetric'),
}).strict()

const IssuerEntrySchema = z.discriminatedUnion('authType', [
    PublicEntrySchema,
    SymmetricEntrySchema,
    AsymmetricEntrySchema,
])

const IssuersSchema = z.array(IssuerEntrySchema)

export type IssuerEntry = z.infer<typeof IssuerEntrySchema>

function readNamedEnv(envName: string, issuerName: string, purpose: string): string {
    const value = process.env[envName]
    if (!value) {
        throw new Error(
            `Issuer '${issuerName}' references environment variable '${envName}' for its ${purpose}, ` +
                `but it is not set.`,
        )
    }
    return value
}

function readPrivateKeyJwk(
    envName: string,
    issuerName: string,
): { privateKeyJwk: string; keyId: string; algorithm: 'RS384' | 'ES384' } {
    const raw = readNamedEnv(envName, issuerName, 'private key')

    let jwk: { kid?: unknown; alg?: unknown }
    try {
        jwk = JSON.parse(raw)
    } catch {
        throw new Error(
            `Issuer '${issuerName}': the private JWK in environment variable '${envName}' is not valid JSON.`,
        )
    }

    if (jwk.alg !== 'RS384' && jwk.alg !== 'ES384') {
        throw new Error(
            `Issuer '${issuerName}': the private JWK in '${envName}' must set "alg" to "RS384" or "ES384" ` +
                `(SMART's required baseline algorithms for private_key_jwt).`,
        )
    }
    if (typeof jwk.kid !== 'string' || jwk.kid.length === 0) {
        throw new Error(`Issuer '${issuerName}': the private JWK in '${envName}' must set a non-empty "kid".`)
    }

    return { privateKeyJwk: raw, keyId: jwk.kid, algorithm: jwk.alg }
}

function toIssuerConfig(entry: IssuerEntry): IssuerConfig {
    switch (entry.authType) {
        case 'public':
            return {
                fhirBaseUrl: entry.fhirBaseUrl,
                clientId: entry.clientId,
                auth: { type: 'public' },
                dynamicallyRegistered: false,
            }

        case 'symmetric':
            return {
                fhirBaseUrl: entry.fhirBaseUrl,
                clientId: entry.clientId,
                auth: {
                    type: 'confidential-symmetric',
                    method: entry.method,
                    clientSecret: readNamedEnv(entry.clientSecretEnv, entry.name, 'client secret'),
                },
                dynamicallyRegistered: false,
            }

        case 'asymmetric':
            return {
                fhirBaseUrl: entry.fhirBaseUrl,
                clientId: entry.clientId,
                auth: {
                    type: 'confidential-asymmetric',
                    ...readPrivateKeyJwk(PRIVATE_KEY_ENV_VAR, entry.name),
                },
                dynamicallyRegistered: false,
            }
    }
}

function assertNoDuplicateIssuers(entries: IssuerEntry[]): void {
    const seen = new Map<string, string>()
    for (const entry of entries) {
        const key = normaliseFhirBaseUrl(entry.fhirBaseUrl)
        const existingName = seen.get(key)
        if (existingName) {
            throw new Error(
                `SMART_ISSUERS has two entries for the same fhirBaseUrl ('${entry.fhirBaseUrl}'): ` +
                    `'${existingName}' and '${entry.name}'. Each FHIR base URL may only be registered once, ` +
                    `so a spoofed discovery document cannot be matched against the wrong entry's credentials.`,
            )
        }
        seen.set(key, entry.name)
    }
}

/**
 * Rejects two entries that reference the same `clientSecretEnv`. Without this, a new PR-contributed
 * entry could deliberately name an existing vendor's already-provisioned secret and this app would
 * hand that vendor's client secret to the new entry's own (attacker-controlled) token endpoint.
 */
function assertNoDuplicateClientSecretEnv(entries: IssuerEntry[]): void {
    const seen = new Map<string, string>()
    for (const entry of entries) {
        if (entry.authType !== 'symmetric') continue

        const existingName = seen.get(entry.clientSecretEnv)
        if (existingName) {
            throw new Error(
                `SMART_ISSUERS has two entries referencing the same clientSecretEnv ` +
                    `('${entry.clientSecretEnv}'): '${existingName}' and '${entry.name}'. Each entry must ` +
                    `reference its own secret, so one vendor's PR cannot claim another vendor's already-` +
                    `provisioned client secret.`,
            )
        }
        seen.set(entry.clientSecretEnv, entry.name)
    }
}

/**
 * Validates a raw `SMART_ISSUERS` JSON string and returns the parsed entries, applying every
 * constraint that keeps a PR-contributed entry safe: the zod schema, the `SMART_CLIENT_SECRET_<NAME>`
 * restriction on `clientSecretEnv`, `.strict()` on asymmetric entries, and the two uniqueness checks.
 *
 * Deliberately reads no secret: `toIssuerConfig` does that separately. That split is what lets CI
 * validate the value committed to `.nais/nais-dev.yaml` without holding any deployment secret
 * (see `manifest-issuers.test.ts`), so a bad entry fails a pull request instead of pod startup.
 *
 * Throws on any problem, since this is our own configuration rather than EHR-supplied input.
 */
export function parseIssuerEntries(raw: string): IssuerEntry[] {
    let json: unknown
    try {
        json = JSON.parse(raw)
    } catch (cause) {
        throw new Error(
            `SMART_ISSUERS is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
        )
    }

    const parsed = IssuersSchema.safeParse(json)
    if (!parsed.success) {
        throw new Error(`SMART_ISSUERS is invalid: ${z.prettifyError(parsed.error)}`)
    }

    assertNoDuplicateIssuers(parsed.data)
    assertNoDuplicateClientSecretEnv(parsed.data)

    return parsed.data
}

function loadIssuers(): IssuerConfig[] {
    const raw = process.env.SMART_ISSUERS
    if (!raw) return []

    return parseIssuerEntries(raw).map(toIssuerConfig)
}

// Parsed eagerly, at module load, so a malformed configuration fails the deployment immediately
// rather than on the first request that happens to touch it.
const issuers: IssuerConfig[] = loadIssuers()

/**
 * Matches on a normalised FHIR base URL: trailing slash ignored, host compared case-insensitively
 * (`URL` already lower-cases it), path compared case-sensitively (paths are meaningful in FHIR
 * base URLs, e.g. multi-tenant EHRs distinguishing tenants by path segment).
 */
function normaliseFhirBaseUrl(value: string): string {
    try {
        const url = new URL(value)
        return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
    } catch {
        return value.replace(/\/+$/, '')
    }
}

/**
 * Looked up by the vendor's TLS-authenticated FHIR base URL (the SMART `iss` launch parameter),
 * never by an OIDC `issuer`. See `resolveIssuerConfig` in `#core/smart/launch`.
 */
export function findIssuerConfig(fhirBaseUrl: string): IssuerConfig | null {
    const target = normaliseFhirBaseUrl(fhirBaseUrl)
    return issuers.find((config) => normaliseFhirBaseUrl(config.fhirBaseUrl) === target) ?? null
}

export function isKnownIssuer(fhirBaseUrl: string): boolean {
    return findIssuerConfig(fhirBaseUrl) !== null
}
