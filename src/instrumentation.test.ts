import { afterEach, describe, expect, it, vi } from 'vitest'

import { register } from './instrumentation'

afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
})

describe('server startup configuration', () => {
    it('rejects startup when a configured client credential is missing', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'nodejs')
        vi.stubEnv(
            'SMART_ISSUERS',
            JSON.stringify([
                {
                    name: 'Test EHR',
                    fhirBaseUrl: 'https://ehr.example.com/fhir',
                    clientId: 'test-client',
                    authType: 'symmetric',
                    clientSecretEnv: 'SMART_CLIENT_SECRET_TEST',
                },
            ]),
        )
        vi.stubEnv('SMART_CLIENT_SECRET_TEST', undefined)

        await expect(register()).rejects.toThrow('SMART_CLIENT_SECRET_TEST')
    })

    it('accepts valid configuration at startup', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'nodejs')
        vi.stubEnv('SMART_ISSUERS', '[]')

        await expect(register()).resolves.toBeUndefined()
    })

    it('does not load Node client credentials in the edge runtime', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'edge')
        vi.stubEnv('SMART_ISSUERS', 'invalid')

        await expect(register()).resolves.toBeUndefined()
    })
})
