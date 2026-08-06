/**
 * A real parser for SMART App Launch scope strings — v1 clinical scopes (`read`/`write`/`*`), v2
 * granular clinical scopes (CRUDS letters, optionally with a `?` query), context/identity/refresh
 * scopes, and the v1<->v2 permission equivalence the spec defines between them.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html
 */

import type { SmartConfiguration } from '#core/smart/types'
import { parseCapabilities } from '#validation/smart/capabilities'
import type { RefTypes } from '#validation/common-refs'
import { navRefs } from '#validation/common-refs'
import { validation, type Validation } from '#validation/validation'

const scopesUrl = 'https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html'

const refs = {
    clinicalScopes: { hl7: `${scopesUrl}#clinical-scope-syntax` },
    v1v2: { hl7: `${scopesUrl}#scopes-for-smart-v1-and-v2-compatibility` },
    contextScopes: { hl7: `${scopesUrl}#context-scopes` },
    identityScopes: { hl7: `${scopesUrl}#scopes-for-requesting-identity-data` },
    refreshScopes: { hl7: `${scopesUrl}#scopes-for-obtaining-refresh-tokens` },
    /** https://hl7.org/fhir/security.html — "least privilege" / servers should not over-grant. */
    security: { hl7: 'https://hl7.org/fhir/security.html' },
    navScopes: { nav: navRefs.smartGettingStarted },
} satisfies Record<string, RefTypes>

export type ScopeCompartment = 'patient' | 'user' | 'system'
export type ContextScopeValue = 'launch' | 'launch/patient' | 'launch/encounter'
export type IdentityScopeValue = 'openid' | 'fhirUser' | 'profile'
export type RefreshScopeValue = 'offline_access' | 'online_access'

export type ClinicalScope = {
    kind: 'clinical'
    raw: string
    compartment: ScopeCompartment
    resource: string
    /** Whether the permission suffix was written using v1 (`read`/`write`/`*`) or v2 (CRUDS) syntax. */
    version: 'v1' | 'v2'
    /** The permission suffix exactly as written, e.g. `read` or `rs`. */
    permission: string
    /** The permission normalized to its canonically-ordered, de-duplicated CRUDS letters. */
    cruds: string
    /** The raw query string after `?`, when this is a v2 granular sub-scope. `null` otherwise. */
    query: string | null
    /** True when the CRUDS letters in `permission` were out of canonical order, or duplicated. */
    permissionMalformedOrder: boolean
}

export type ContextScope = { kind: 'context'; raw: string; context: ContextScopeValue }
export type IdentityScope = { kind: 'identity'; raw: string; identity: IdentityScopeValue }
export type RefreshScope = { kind: 'refresh'; raw: string; refresh: RefreshScopeValue }
export type OrchestrateScope = { kind: 'orchestrate'; raw: string }
export type UnrecognisedScope = { kind: 'unrecognised'; raw: string }
export type MalformedScope = { kind: 'malformed'; raw: string; reason: string }

export type ParsedScope =
    | ClinicalScope
    | ContextScope
    | IdentityScope
    | RefreshScope
    | OrchestrateScope
    | UnrecognisedScope
    | MalformedScope

/** c, r, u, d, s — the canonical order SMART v2 requires CRUDS letters to appear in. */
const CANONICAL_ORDER = ['c', 'r', 'u', 'd', 's']

/** The v1<->v2 clinical scope permission equivalence: https://hl7.org/fhir/smart-app-launch/scopes-and-launch-context.html#scopes-for-smart-v1-and-v2-compatibility */
export const V1_TO_V2_CRUDS = {
    read: 'rs',
    write: 'cud',
    '*': 'cruds',
} as const satisfies Record<string, string>

export function v1EquivalentCruds(permission: 'read' | 'write' | '*'): string {
    return V1_TO_V2_CRUDS[permission]
}

/**
 * The inverse mapping. Only `rs`, `cud` and `cruds` (in any order, without duplicates) have a v1
 * equivalent; every other CRUDS combination (e.g. `r`, `cu`, `rds`) is only expressible in v2.
 */
export function v2EquivalentV1(cruds: string): 'read' | 'write' | '*' | null {
    const normalized = [...new Set(cruds)].toSorted().join('')
    if (normalized === 'rs') return 'read'
    if (normalized === 'cdu') return 'write'
    if (normalized === 'cdrsu') return '*'
    return null
}

const CLINICAL_SCOPE_RE = /^(patient|user|system)\/([A-Za-z*]+)\.([A-Za-z*]+)(?:\?(.*))?$/

function classifyPermission(
    permission: string,
): { version: 'v1' | 'v2'; cruds: string; permissionMalformedOrder: boolean } | null {
    if (permission === 'read')
        return { version: 'v1', cruds: V1_TO_V2_CRUDS.read, permissionMalformedOrder: false }
    if (permission === 'write')
        return { version: 'v1', cruds: V1_TO_V2_CRUDS.write, permissionMalformedOrder: false }
    if (permission === '*')
        return { version: 'v1', cruds: V1_TO_V2_CRUDS['*'], permissionMalformedOrder: false }

    if (!/^[cruds]+$/.test(permission)) return null

    const seen = new Set<string>()
    let permissionMalformedOrder = false
    let lastIndex = -1
    for (const letter of permission) {
        const index = CANONICAL_ORDER.indexOf(letter)
        if (seen.has(letter) || index <= lastIndex) permissionMalformedOrder = true
        seen.add(letter)
        lastIndex = Math.max(lastIndex, index)
    }

    const cruds = CANONICAL_ORDER.filter((letter) => seen.has(letter)).join('')
    return { version: 'v2', cruds, permissionMalformedOrder }
}

function parseClinicalScope(raw: string): ClinicalScope | MalformedScope {
    const match = CLINICAL_SCOPE_RE.exec(raw)
    if (!match) {
        return {
            kind: 'malformed',
            raw,
            reason:
                'expected `<patient|user|system>/<Resource|*>.<permission>`, optionally followed by a ' +
                '`?` query for a v2 granular sub-scope',
        }
    }

    const [, compartmentRaw, resource, permission, query] = match
    if (compartmentRaw === undefined || resource === undefined || permission === undefined) {
        return { kind: 'malformed', raw, reason: 'could not parse compartment, resource or permission' }
    }

    const classified = classifyPermission(permission)
    if (!classified) {
        return {
            kind: 'malformed',
            raw,
            reason:
                `the permission suffix \`${permission}\` is neither a SMART v1 permission ` +
                '(`read`, `write`, `*`) nor a v2 CRUDS combination (letters from `c`, `r`, `u`, `d`, `s`)',
        }
    }

    return {
        kind: 'clinical',
        raw,
        compartment: compartmentRaw as ScopeCompartment,
        resource,
        version: classified.version,
        permission,
        cruds: classified.cruds,
        query: query ?? null,
        permissionMalformedOrder: classified.permissionMalformedOrder,
    }
}

/** Parses a single scope token. Never throws — an unparseable token becomes a `malformed` scope. */
export function parseScope(raw: string): ParsedScope {
    if (raw === 'launch') return { kind: 'context', raw, context: 'launch' }
    if (raw === 'launch/patient') return { kind: 'context', raw, context: 'launch/patient' }
    if (raw === 'launch/encounter') return { kind: 'context', raw, context: 'launch/encounter' }
    if (raw === 'openid') return { kind: 'identity', raw, identity: 'openid' }
    if (raw === 'fhirUser') return { kind: 'identity', raw, identity: 'fhirUser' }
    if (raw === 'profile') return { kind: 'identity', raw, identity: 'profile' }
    if (raw === 'offline_access') return { kind: 'refresh', raw, refresh: 'offline_access' }
    if (raw === 'online_access') return { kind: 'refresh', raw, refresh: 'online_access' }
    if (raw === 'smart/orchestrate_launch') return { kind: 'orchestrate', raw }

    if (/^(patient|user|system)\//.test(raw)) return parseClinicalScope(raw)

    return { kind: 'unrecognised', raw }
}

/** Splits a `scope` string on whitespace and parses each token. Tolerates repeated/odd whitespace. */
export function parseScopeString(scopeString: string): ParsedScope[] {
    return scopeString
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0)
        .map(parseScope)
}

function scopeFamilyKey(scope: ParsedScope): string {
    switch (scope.kind) {
        case 'clinical':
            return `clinical:${scope.compartment}/${scope.resource}:${scope.query ?? ''}`
        case 'context':
            return `context:${scope.context}`
        case 'identity':
            return `identity:${scope.identity}`
        case 'refresh':
            return `refresh:${scope.refresh}`
        case 'orchestrate':
            return 'orchestrate'
        case 'unrecognised':
        case 'malformed':
            return `raw:${scope.raw}`
    }
}

export type ScopeDiffStatus = 'as-requested' | 'narrowed' | 'not-granted' | 'ungranted-extra'

export type ScopeDiffEntry = {
    status: ScopeDiffStatus
    requested: ParsedScope | null
    granted: ParsedScope | null
    /**
     * For a matched clinical scope: CRUDS letters the server granted beyond what was requested
     * for the same resource/query. A security smell per https://hl7.org/fhir/security.html —
     * reported independently of `status`, which only reflects whether the request was satisfied.
     */
    extraCruds?: string
}

/**
 * Compares what was requested against what was granted, per scope. Clinical scopes are matched
 * by compartment/resource/query — a granular sub-scope's `?query` is part of its identity, so a
 * server that grants the same resource without the restriction is treated as a different scope
 * (visible as a `not-granted` + `ungranted-extra` pair) rather than silently merged.
 */
export function diffScopes(requested: string, granted: string): ScopeDiffEntry[] {
    const requestedScopes = parseScopeString(requested)
    const grantedScopes = parseScopeString(granted)

    const grantedByKey = new Map<string, ParsedScope>()
    for (const scope of grantedScopes) grantedByKey.set(scopeFamilyKey(scope), scope)

    const matchedGrantedKeys = new Set<string>()
    const entries: ScopeDiffEntry[] = []

    for (const req of requestedScopes) {
        const key = scopeFamilyKey(req)
        const grant = grantedByKey.get(key)
        if (!grant) {
            entries.push({ status: 'not-granted', requested: req, granted: null })
            continue
        }
        matchedGrantedKeys.add(key)

        if (req.kind === 'clinical' && grant.kind === 'clinical') {
            const requestedLetters = new Set(req.cruds)
            const grantedLetters = new Set(grant.cruds)
            const missing = [...requestedLetters].filter((letter) => !grantedLetters.has(letter))
            const extra = [...grantedLetters].filter((letter) => !requestedLetters.has(letter))

            entries.push({
                status: missing.length === 0 ? 'as-requested' : 'narrowed',
                requested: req,
                granted: grant,
                extraCruds: extra.length > 0 ? extra.join('') : undefined,
            })
            continue
        }

        entries.push({ status: 'as-requested', requested: req, granted: grant })
    }

    for (const grant of grantedScopes) {
        if (!matchedGrantedKeys.has(scopeFamilyKey(grant))) {
            entries.push({ status: 'ungranted-extra', requested: null, granted: grant })
        }
    }

    return entries
}

/**
 * The scopes Nav's own client registration requests (see the getting-started guide), used as the
 * default set of "Nav depends on this" scopes for `validateScopes`. Expressed as raw v1 scope
 * strings because that is what Nav's client currently requests; matching is by
 * compartment/resource family, so a server granting the v2 equivalent still satisfies it.
 */
export const NAV_REQUIRED_SCOPES: readonly string[] = [
    'openid',
    'fhirUser',
    'launch',
    'patient/Patient.read',
    'patient/Encounter.read',
    'patient/DocumentReference.read',
    'patient/DocumentReference.write',
]

function describeScope(scope: ParsedScope): string {
    return `\`${scope.raw}\``
}

function refsFor(scope: ParsedScope): RefTypes {
    switch (scope.kind) {
        case 'clinical':
            return refs.clinicalScopes
        case 'context':
            return refs.contextScopes
        case 'identity':
            return refs.identityScopes
        case 'refresh':
            return refs.refreshScopes
        default:
            return refs.clinicalScopes
    }
}

export type ValidateScopesOptions = {
    requestedScope: string
    grantedScope: string
    smartConfiguration: SmartConfiguration
    /** Scopes Nav's own flows depend on. Defaults to `NAV_REQUIRED_SCOPES`. */
    navRequiredScopes?: readonly string[]
}

/**
 * Turns a requested/granted scope pair into a full checklist of findings: malformed scope
 * strings, CRUDS-order problems, narrowed or ungranted permissions, over-granting, v1/v2 version
 * mismatches against the server's advertised capabilities, and Nav-critical scopes that were
 * requested but never granted.
 */
export function validateScopes(options: ValidateScopesOptions): Validation[] {
    const { requestedScope, grantedScope, smartConfiguration } = options
    const navRequiredScopes = options.navRequiredScopes ?? NAV_REQUIRED_SCOPES
    const navRequiredKeys = new Set(navRequiredScopes.map((raw) => scopeFamilyKey(parseScope(raw))))

    const results: Validation[] = []
    const requestedScopes = parseScopeString(requestedScope)

    for (const scope of requestedScopes) {
        if (scope.kind === 'malformed') {
            results.push(
                validation(
                    `The requested scope ${describeScope(scope)} is malformed: ${scope.reason}.`,
                    'ERROR',
                    refs.clinicalScopes,
                ),
            )
            continue
        }
        if (scope.kind === 'unrecognised') {
            results.push(
                validation(
                    `Unrecognised scope ${describeScope(scope)} was requested; it matches none of the ` +
                        'SMART clinical, context, identity, refresh or orchestrate scope grammars',
                    'INFO',
                ),
            )
            continue
        }
        if (scope.kind === 'clinical' && scope.permissionMalformedOrder) {
            results.push(
                validation(
                    `The scope ${describeScope(scope)} lists CRUDS letters out of canonical order or ` +
                        `with duplicates; SMART v2 requires the order c, r, u, d, s (got \`${scope.permission}\`).`,
                    'WARNING',
                    refs.v1v2,
                ),
            )
        }
    }

    const diff = diffScopes(requestedScope, grantedScope)
    const { known: knownCapabilities } = parseCapabilities(smartConfiguration)
    const grantedVersions = new Set(
        diff
            .map((entry) => entry.granted)
            .filter((scope): scope is ClinicalScope => scope?.kind === 'clinical')
            .map((scope) => scope.version),
    )

    for (const entry of diff) {
        // Malformed/unrecognised scopes already produced their own finding above; a "not granted"
        // note about the same scope would just be noise since it can never be sensibly granted.
        const requestedKind = entry.requested?.kind
        if (requestedKind === 'malformed' || requestedKind === 'unrecognised') continue

        if (entry.status === 'not-granted' && entry.requested) {
            const isNavRequired = navRequiredKeys.has(scopeFamilyKey(entry.requested))
            const message = `Scope ${describeScope(entry.requested)} was requested but was not granted at all.`
            if (isNavRequired) {
                results.push(
                    validation(
                        `${message} Nav requires this scope to be granted for its sykmelding pre-fill flow.`,
                        'ERROR',
                        { ...refsFor(entry.requested), nav: navRefs.smartGettingStarted },
                    ),
                )
            } else {
                results.push(validation(message, 'WARNING', refsFor(entry.requested)))
            }
            continue
        }

        if (entry.status === 'narrowed' && entry.requested && entry.granted) {
            const requested = entry.requested
            const granted = entry.granted
            if (requested.kind !== 'clinical' || granted.kind !== 'clinical') continue

            const missing = [...new Set(requested.cruds)].filter((letter) => !granted.cruds.includes(letter))
            const isNavRequired = navRequiredKeys.has(scopeFamilyKey(requested))
            const message =
                `Scope ${describeScope(requested)} was narrowed by the server: only \`${granted.cruds}\` ` +
                `was granted, missing \`${missing.join('')}\`.`

            if (isNavRequired) {
                results.push(
                    validation(
                        `${message} Nav depends on this access for its sykmelding pre-fill flow.`,
                        'ERROR',
                        { ...refs.v1v2, nav: navRefs.smartGettingStarted },
                    ),
                )
            } else {
                results.push(validation(message, 'WARNING', refs.v1v2))
            }
        }

        if (entry.status === 'as-requested' && entry.requested && entry.granted) {
            const requested = entry.requested
            const granted = entry.granted
            if (requested.kind === 'clinical' && granted.kind === 'clinical') {
                if (requested.version === 'v2' && granted.version === 'v1') {
                    results.push(
                        validation(
                            `Scope ${describeScope(requested)} (v2 syntax) was granted using the v1-equivalent ` +
                                `\`${granted.permission}\` (v1 syntax); this is a legitimate v1-only server, but the ` +
                                'app should treat the granted permission as v1.',
                            'INFO',
                            refs.v1v2,
                        ),
                    )
                } else {
                    results.push(
                        validation(
                            `Scope ${describeScope(requested)} was granted as requested`,
                            'OK',
                            refsFor(requested),
                        ),
                    )
                }
            } else {
                results.push(
                    validation(
                        `Scope ${describeScope(requested)} was granted as requested`,
                        'OK',
                        refsFor(requested),
                    ),
                )
            }
        }

        if (entry.extraCruds && entry.granted?.kind === 'clinical') {
            results.push(
                validation(
                    `Scope ${describeScope(entry.granted)} was granted with extra permissions ` +
                        `(\`${entry.extraCruds}\`) beyond what was requested; a server granting more than asked ` +
                        'is a security smell — least privilege should be preferred.',
                    'WARNING',
                    refs.security,
                ),
            )
        }

        if (entry.status === 'ungranted-extra' && entry.granted) {
            results.push(
                validation(
                    `Scope ${describeScope(entry.granted)} was granted but never requested; a server granting ` +
                        'more than asked is a security smell — least privilege should be preferred.',
                    'WARNING',
                    refs.security,
                ),
            )
        }
    }

    if (grantedVersions.has('v1') && !knownCapabilities.includes('permission-v1')) {
        results.push(
            validation(
                'The server granted scopes using SMART v1 syntax (`read`/`write`/`*`) without advertising ' +
                    'the `permission-v1` capability in its SMART configuration.',
                'WARNING',
                refs.v1v2,
            ),
        )
    }
    if (grantedVersions.has('v2') && !knownCapabilities.includes('permission-v2')) {
        results.push(
            validation(
                'The server granted scopes using SMART v2 granular syntax (CRUDS letters) without ' +
                    'advertising the `permission-v2` capability in its SMART configuration.',
                'WARNING',
                refs.v1v2,
            ),
        )
    }

    return results
}
