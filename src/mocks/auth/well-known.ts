import type { Context } from 'hono'

import type { MockClientAuthMethod, MockState } from '#mocks/state'

/**
 * The `.well-known/smart-configuration` document. Conformant by default per
 * https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html: every REQUIRED and
 * RECOMMENDED field the spec lists is populated, and `capabilities` reflects the client
 * authentication method this instance was configured to require.
 */

function capabilitiesFor(clientAuth: MockClientAuthMethod, includeSso: boolean): string[] {
    const clientCapability: Record<MockClientAuthMethod, string> = {
        public: 'client-public',
        client_secret_basic: 'client-confidential-symmetric',
        client_secret_post: 'client-confidential-symmetric',
        private_key_jwt: 'client-confidential-asymmetric',
    }

    return [
        'launch-ehr',
        'launch-standalone',
        'authorize-post',
        clientCapability[clientAuth],
        ...(includeSso ? ['sso-openid-connect'] : []),
        'context-banner',
        'context-style',
        'context-ehr-patient',
        'context-ehr-encounter',
        'context-standalone-patient',
        'context-standalone-encounter',
        'permission-offline',
        'permission-online',
        'permission-patient',
        'permission-user',
        'permission-v1',
        'permission-v2',
    ]
}

function buildDocument(state: MockState): Record<string, unknown> {
    const { baseUrl, defects, clientAuth } = state
    const includeSso = !defects.has('no-sso-openid-connect')

    const doc: Record<string, unknown> = {
        ...(includeSso ? { issuer: baseUrl } : {}),
        ...(includeSso ? { jwks_uri: `${baseUrl}/.well-known/jwks.json` } : {}),
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: [
            'none',
            'client_secret_basic',
            'client_secret_post',
            'private_key_jwt',
        ],
        scopes_supported: [
            'openid',
            'fhirUser',
            'launch',
            'launch/patient',
            'offline_access',
            'online_access',
            'patient/*.*',
            'user/*.*',
        ],
        response_types_supported: ['code'],
        management_endpoint: `${baseUrl}/manage`,
        introspection_endpoint: `${baseUrl}/introspect`,
        revocation_endpoint: `${baseUrl}/revoke`,
        capabilities: capabilitiesFor(clientAuth, includeSso),
        code_challenge_methods_supported: defects.has('well-known-allows-plain-pkce')
            ? ['S256', 'plain']
            : ['S256'],
    }

    if (defects.has('well-known-missing-code-challenge-methods')) {
        delete doc.code_challenge_methods_supported
    }

    if (defects.has('well-known-missing-required-fields')) {
        delete doc.authorization_endpoint
        delete doc.token_endpoint
        delete doc.grant_types_supported
        delete doc.capabilities
    }

    if (defects.has('well-known-relative-urls')) {
        for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'registration_endpoint']) {
            const value = doc[key]
            if (typeof value === 'string') doc[key] = value.replace(baseUrl, '')
        }
    }

    return doc
}

export function wellKnownSmartConfigurationHandler(state: MockState) {
    return (c: Context): Response => {
        if (state.defects.has('well-known-404')) return new Response(null, { status: 404 })
        if (state.defects.has('well-known-not-json')) {
            return new Response('this is not the json you are looking for', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
            })
        }

        return c.json(buildDocument(state))
    }
}
