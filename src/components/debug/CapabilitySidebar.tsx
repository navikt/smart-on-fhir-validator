'use client'

import { useEffect, useState, type ReactElement } from 'react'

import type { CapabilityResource, CapabilitySummary } from '#core/debug/capabilities'

import { ErrorNote } from './ErrorNote'
import { EYEBROW_CLASSES } from './styles'

export type CapabilityState =
    | { status: 'loading' }
    | { status: 'error'; detail: string }
    | { status: 'ready'; summary: CapabilitySummary }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadCapabilities(signal: AbortSignal): Promise<CapabilityState> {
    try {
        const response = await fetch('/api/debug/capabilities', { cache: 'no-store', signal })
        const payload: unknown = await response.json().catch(() => null)

        if (response.ok && isRecord(payload) && isRecord(payload.capabilities)) {
            return { status: 'ready', summary: payload.capabilities as CapabilitySummary }
        }

        const detail = isRecord(payload) && typeof payload.detail === 'string' ? payload.detail : null
        return { status: 'error', detail: detail ?? `The server answered HTTP ${response.status}.` }
    } catch (error) {
        return {
            status: 'error',
            detail: error instanceof Error ? error.message : 'The CapabilityStatement could not be loaded.',
        }
    }
}

export function useCapabilities(): { state: CapabilityState; retry: () => void } {
    const [attempt, setAttempt] = useState(0)
    const [loaded, setLoaded] = useState<{ attempt: number; state: CapabilityState } | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        const run = async (): Promise<void> => {
            const state = await loadCapabilities(controller.signal)
            if (!controller.signal.aborted) setLoaded({ attempt, state })
        }
        void run()
        return () => controller.abort()
    }, [attempt])

    return {
        state: loaded?.attempt === attempt ? loaded.state : { status: 'loading' },
        retry: () => setAttempt((value) => value + 1),
    }
}

export function CapabilitySidebar({
    state,
    onRetry,
    onSelect,
}: {
    state: CapabilityState
    onRetry: () => void
    onSelect: (resource: CapabilityResource) => void
}): ReactElement {
    return (
        <aside
            aria-label="CapabilityStatement"
            className="flex flex-col gap-3 rounded border border-ax-border-neutral-subtle bg-white px-4 py-[18px] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
        >
            <h2 className={EYEBROW_CLASSES}>CapabilityStatement</h2>

            {state.status === 'loading' && (
                <p role="status" className="text-16">
                    Loading the CapabilityStatement…
                </p>
            )}

            {state.status === 'error' && (
                <>
                    <ErrorNote title="Could not load the CapabilityStatement" detail={state.detail} />
                    <button
                        type="button"
                        onClick={onRetry}
                        className="text-16 text-ax-text-accent min-h-11 self-start font-semibold underline"
                    >
                        Try again
                    </button>
                </>
            )}

            {state.status === 'ready' && (
                <>
                    <p className="text-14 text-ax-text-neutral-subtle">
                        {state.summary.fhirVersion ? `FHIR ${state.summary.fhirVersion}. ` : ''}
                        {state.summary.resources.length} resource types. Select one to fill in the request.
                    </p>
                    <p className="text-14">
                        Not listed in the CapabilityStatement? Choose Custom in the Resource type list and
                        type any resource name.
                    </p>
                    {state.summary.resources.length === 0 ? (
                        <p className="text-14 text-ax-text-neutral-subtle">
                            The server lists no resource types.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-3">
                            {state.summary.resources.map((resource) => (
                                <li key={resource.type} className="flex flex-col gap-1">
                                    <button
                                        type="button"
                                        onClick={() => onSelect(resource)}
                                        className="text-16 text-ax-text-accent min-h-11 self-start font-mono font-semibold underline"
                                    >
                                        {resource.type}
                                    </button>
                                    {resource.interactions.length > 0 && (
                                        <p className="text-13 break-words text-ax-text-neutral-subtle">
                                            {resource.interactions.join(', ')}
                                        </p>
                                    )}
                                    {resource.searchParams.length > 0 && (
                                        <p className="text-13 font-mono break-words text-ax-text-neutral-subtle">
                                            {resource.searchParams.map((param) => param.name).join(', ')}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </aside>
    )
}
