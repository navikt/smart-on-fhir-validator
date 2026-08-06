/**
 * Static, per-issuer client configuration — the primary way this app authenticates to an EHR's
 * token endpoint. Dynamic client registration (`registration.ts`) is only the fallback for
 * vendors that support RFC 7591 and for whom no entry exists here.
 *
 * Configuration comes from the `SMART_ISSUERS` environment variable, a JSON array. This is our
 * own configuration (not EHR-supplied input), so a malformed value is a deployment error and is
 * allowed — and expected — to crash the process at startup rather than degrade silently.
 */

import * as z from 'zod'

import type { IssuerConfig } from '#core/smart/types'

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
    /** Name of the environment variable holding the secret — never the secret value itself. */
    clientSecretEnv: z.string().min(1),
})

const AsymmetricEntrySchema = BaseEntrySchema.extend({
    authType: z.literal('asymmetric'),
    /** Name of the environment variable holding this app's private JWK — never the key itself. */
    privateKeyJwkEnv: z.string().min(1),
})

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
                    ...readPrivateKeyJwk(entry.privateKeyJwkEnv, entry.name),
                },
                dynamicallyRegistered: false,
            }
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
