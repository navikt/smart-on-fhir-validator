/**
 * A process-wide singleton, anchored on `globalThis`.
 *
 * A plain module-level `let` is not enough in Next.js. Route Handlers and Page Server Components
 * are compiled into separate module graphs, so the same file can be instantiated more than once
 * in one process and each copy gets its own module-level state. A store written by `/callback`
 * (a Route Handler) and read by `/report` (a Page) therefore reads from a different, empty
 * instance — the write is simply lost, with no error to show for it.
 *
 * `globalThis` is the one thing every graph in the process genuinely shares, so state that must
 * survive that boundary is keyed there instead.
 *
 * This only shares state within a single process. That is sufficient because it is a *fallback*
 * for local development and tests; deployed environments set `VALKEY_URI_SESSIONS`, and Valkey is
 * what makes state survive across replicas and restarts.
 */

const registry = globalThis as unknown as { smartValidatorSingletons?: Map<string, unknown> }

function store(): Map<string, unknown> {
    registry.smartValidatorSingletons ??= new Map<string, unknown>()
    return registry.smartValidatorSingletons
}

/**
 * Returns the value previously built for `key`, or builds and remembers it on first call.
 *
 * `build` is invoked at most once per key. Caching a promise is safe and intended: two concurrent
 * first callers both receive the same in-flight promise rather than racing to construct two
 * backends (and, for Valkey, two connections).
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
