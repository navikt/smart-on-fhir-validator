import { detectFhirVersion } from '#core/smart/capability-statement'

export type CapabilitySearchParam = { name: string; type: string | null }

export type CapabilityResource = {
    type: string
    interactions: string[]
    searchParams: CapabilitySearchParam[]
    operations: string[]
}

export type CapabilitySummary = {
    fhirVersion: string | null
    resources: CapabilityResource[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function entries(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : []
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function sortedUnique(values: (string | null)[]): string[] {
    return [...new Set(values.filter((value): value is string => value !== null))].toSorted()
}

function summarizeSearchParams(entry: Record<string, unknown>): CapabilitySearchParam[] {
    const byName = new Map<string, string | null>()
    for (const param of entries(entry.searchParam)) {
        const name = nonEmptyString(param.name)
        if (name === null) continue
        const type = nonEmptyString(param.type)
        if (type !== null || !byName.has(name)) byName.set(name, type ?? byName.get(name) ?? null)
    }
    return [...byName]
        .map(([name, type]) => ({ name, type }))
        .toSorted((a, b) => a.name.localeCompare(b.name))
}

function summarizeResource(entry: Record<string, unknown>): CapabilityResource | null {
    const type = nonEmptyString(entry.type)
    if (type === null) return null

    return {
        type,
        interactions: sortedUnique(entries(entry.interaction).map((item) => nonEmptyString(item.code))),
        searchParams: summarizeSearchParams(entry),
        operations: sortedUnique(entries(entry.operation).map((item) => nonEmptyString(item.name))),
    }
}

export function summarizeCapabilityStatement(statement: unknown): CapabilitySummary {
    const fhirVersion = detectFhirVersion(statement)
    if (!isRecord(statement)) return { fhirVersion, resources: [] }

    const byType = new Map<string, CapabilityResource>()
    for (const rest of entries(statement.rest)) {
        for (const entry of entries(rest.resource)) {
            const resource = summarizeResource(entry)
            if (!resource) continue

            const existing = byType.get(resource.type)
            if (!existing) {
                byType.set(resource.type, resource)
                continue
            }
            const merged = new Map(existing.searchParams.map((param) => [param.name, param.type]))
            for (const param of resource.searchParams) {
                if (param.type !== null || !merged.has(param.name)) merged.set(param.name, param.type)
            }
            byType.set(resource.type, {
                type: resource.type,
                interactions: sortedUnique([...existing.interactions, ...resource.interactions]),
                searchParams: [...merged]
                    .map(([name, type]) => ({ name, type }))
                    .toSorted((a, b) => a.name.localeCompare(b.name)),
                operations: sortedUnique([...existing.operations, ...resource.operations]),
            })
        }
    }

    return {
        fhirVersion,
        resources: [...byType.values()].toSorted((a, b) => a.type.localeCompare(b.type)),
    }
}
