import type { Defect, MockEhrConfig, MockClientAuthMethod } from '#mocks/server'
import { createMockEhr } from '#mocks/server'
import { processSingleton } from '#core/storage/process-singleton'

import { getAppOrigin } from '../../../../app-origin'

export const runtime = 'nodejs'

/**
 * The mock EHR issues real access tokens and signs `id_token`s, so it must never be reachable in
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

// One instance per server process: issued codes/tokens, dynamically registered clients and
// written resources must persist across requests for a launch flow to complete.
const MOCK_EHR_KEY = 'mock-ehr'

function getMockEhr(baseUrl: string): ReturnType<typeof createMockEhr> {
    return processSingleton(MOCK_EHR_KEY, () => createMockEhr(configFromEnv(baseUrl)))
}

async function handle(request: Request): Promise<Response> {
    if (!isEnabled()) return new Response(null, { status: 404 })

    // Deliberately not `new URL(request.url).host`: under `output: 'standalone'` that is the
    // server's own bind address, so the mock EHR would advertise unreachable `0.0.0.0` endpoints.
    const baseUrl = `${await getAppOrigin()}/api/mocks/fhir`
    const app = await getMockEhr(baseUrl)

    return app.fetch(request)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const DELETE = handle
export const PATCH = handle
