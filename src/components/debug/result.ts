import type { HttpExchange } from '#core/http/exchange'

export type DebugResult =
    | { kind: 'exchange'; exchange: HttpExchange; bodyTruncated: boolean }
    | { kind: 'failure'; error: string; detail: string }
