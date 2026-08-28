/**
 * Static, per-issuer client configuration — the primary way this app authenticates to an EHR's
 * token endpoint. Dynamic client registration (`registration.ts`) is the fallback for vendors
 * that support RFC 7591 and have no entry here.
 *
 * Read from the `SMART_ISSUERS` environment variable (a JSON array). This is our own
 * configuration, not EHR-supplied input, so a malformed value crashes at startup by design.
 *
 * `SMART_ISSUERS` is meant to be reviewable in a public pull request (see `.nais/nais-dev.yaml`,
 * not a secret): every field here is a name or a public identifier, never a secret value. Three
 * constraints keep that true even once entries are contributed by outside vendors:
 *
 * - `clientSecretEnv` must match `SMART_CLIENT_SECRET_<NAME>` — never an arbitrary variable name,
 *   so a PR-contributed entry cannot reference an unrelated secret such as `SMART_PRIVATE_JWK`.
 * - Every `clientSecretEnv` value must be unique across the whole array (`assertNoDuplicateClientSecretEnv`)
 *   — otherwise a new entry could deliberately name an existing vendor's already-provisioned secret
 *   and have this app hand that vendor's client secret to the new entry's own token endpoint.
 * - `asymmetric` entries carry no env var at all: this app has exactly one signing identity,
 *   published as a whole at `.well-known/jwks.json` (`#core/smart/jwks`), so every `private_key_jwt`
 *   issuer necessarily uses that same key — there is no second private key to reference.
 */

import * as z from 'zod'

import type { IssuerConfig } from '#core/smart/types'

/** This app's one signing identity — see `#core/smart/jwks`. Never issuer-configurable. */
const PRIVATE_KEY_ENV_VAR = 'SMART_PRIVATE_JWK'

const BaseEntrySchema = z.object({
    name: z.string().min(1),
    issuer: z.url(),
    clientId: z.string().min(1),
})

const PublicEntrySchema = BaseEntrySchema.extend({
    authType: z.literal('public'),
})

const SymmetricEntrySchema = BaseEntrySchema.extend({
    authType: z.literal('symmetric'),
    // RFC 6749 does not mandate a client auth method; 'client_secret_basic' is the traditional
    // default for confidential clients that do not otherwise negotiate one.
    method: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),
    /**
     * Name of the environment variable holding the secret — never the secret value itself, and
     * constrained to this prefix so a contributed entry cannot name an unrelated variable.
     */
    clientSecretEnv: z.string().regex(/^SMART_CLIENT_SECRET_[A-Z0-9_]+$/, {
        message: "clientSecretEnv must look like 'SMART_CLIENT_SECRET_<NAME>'",
    }),
})

const AsymmetricEntrySchema = BaseEntrySchema.extend({
    authType: z.literal('asymmetric'),
}).strict()

const IssuerEntrySchema = z.discriminatedUnion('authType', [
    PublicEntrySchema,
    SymmetricEntrySchema,
    AsymmetricEntrySchema,
])

const IssuersSchema = z.array(IssuerEntrySchema)

type IssuerEntry = z.infer<typeof IssuerEntrySchema>

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
                issuer: entry.issuer,
                clientId: entry.clientId,
                auth: { type: 'public' },
                dynamicallyRegistered: false,
            }

        case 'symmetric':
            return {
                issuer: entry.issuer,
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
                issuer: entry.issuer,
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
        const key = normaliseIssuerUrl(entry.issuer)
        const existingName = seen.get(key)
        if (existingName) {
            throw new Error(
                `SMART_ISSUERS has two entries for the same issuer ('${entry.issuer}'): ` +
                    `'${existingName}' and '${entry.name}'. Each issuer may only be registered once, so a ` +
                    `spoofed discovery document cannot be matched against the wrong entry's credentials.`,
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

function loadIssuers(): IssuerConfig[] {
    const raw = process.env.SMART_ISSUERS
    if (!raw) return []

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

    return parsed.data.map(toIssuerConfig)
}

// Parsed eagerly, at module load, so a malformed configuration fails the deployment immediately
// rather than on the first request that happens to touch it.
const issuers: IssuerConfig[] = loadIssuers()

/**
 * Matches on a normalised issuer URL: trailing slash ignored, host compared case-insensitively
 * (`URL` already lower-cases it), path compared case-sensitively (paths are meaningful in FHIR
 * base URLs, e.g. multi-tenant EHRs distinguishing tenants by path segment).
 */
function normaliseIssuerUrl(value: string): string {
    try {
        const url = new URL(value)
        return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
    } catch {
        return value.replace(/\/+$/, '')
    }
}

export function findIssuerConfig(issuer: string): IssuerConfig | null {
    const target = normaliseIssuerUrl(issuer)
    return issuers.find((config) => normaliseIssuerUrl(config.issuer) === target) ?? null
}

export function isKnownIssuer(issuer: string): boolean {
    return findIssuerConfig(issuer) !== null
}
