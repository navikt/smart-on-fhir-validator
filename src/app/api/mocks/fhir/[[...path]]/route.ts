import type { Defect, MockEhrConfig, MockClientAuthMethod } from '#mocks/server'
import { createMockEhr } from '#mocks/server'

export const runtime = 'nodejs'

/**
 * The mock EHR issues real access tokens and signs `id_token`s — it must never be reachable in
 * a production deployment. `ENABLE_MOCK_EHR=true` exists purely for a deliberately-exposed demo
 * environment and must be set with full awareness of that risk.
 */
function isEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' || process.env.ENABLE_MOCK_EHR === 'true'
}

function configFromEnv(baseUrl: string): MockEhrConfig {
    const clientAuth = process.env.MOCK_EHR_CLIENT_AUTH as MockClientAuthMethod | undefined
    const defects = process.env.MOCK_EHR_DEFECTS?.split(',')
        .map((defect) => defect.trim())
        .filter((defect): defect is Defect => defect.length > 0)

    return {
        baseUrl,
        clientAuth,
        clientId: process.env.MOCK_EHR_CLIENT_ID,
        clientSecret: process.env.MOCK_EHR_CLIENT_SECRET,
        defects,
    }
}

// One instance per server process: state (issued codes/tokens, dynamically registered clients,
// written resources) must persist across requests for a manual `yarn dev` launch flow to work.
let mockEhr: ReturnType<typeof createMockEhr> | undefined

function getMockEhr(baseUrl: string): ReturnType<typeof createMockEhr> {
    mockEhr ??= createMockEhr(configFromEnv(baseUrl))
    return mockEhr
}

async function handle(request: Request): Promise<Response> {
    if (!isEnabled()) return new Response(null, { status: 404 })

    const url = new URL(request.url)
    const baseUrl = `${url.protocol}//${url.host}/api/mocks/fhir`
    const app = await getMockEhr(baseUrl)

    return app.fetch(request)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const DELETE = handle
export const PATCH = handle
