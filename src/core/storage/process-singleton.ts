/**
 * A process-wide singleton, anchored on `globalThis`.
 *
 * A module-level `let` is not enough: Route Handlers and Page Server Components are compiled into
 * separate module graphs, so state written by `/callback` is invisible to `/report`: the write
 * is lost silently. Only `globalThis` is shared across those graphs.
 *
 * This shares state within one process only: sessions and reports are in-memory and do not
 * survive a pod restart or replicate across pods.
 */

const registry = globalThis as unknown as { smartValidatorSingletons?: Map<string, unknown> }

function store(): Map<string, unknown> {
    registry.smartValidatorSingletons ??= new Map<string, unknown>()
    return registry.smartValidatorSingletons
}

/**
 * Returns the value previously built for `key`, or builds and remembers it on first call.
 */
export function processSingleton<T>(key: string, build: () => T): T {
    const singletons = store()

    if (!singletons.has(key)) singletons.set(key, build())

    return singletons.get(key) as T
}

/** Test-only: forgets `key` so the next call rebuilds it, e.g. after changing an env var. */
export function resetProcessSingleton(key: string): void {
    store().delete(key)
}
