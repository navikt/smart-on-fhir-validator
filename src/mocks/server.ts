import { Hono } from 'hono'

import { binaryRouter } from './fhir/binary'
import { conditionRouter } from './fhir/condition'
import { documentReferenceRouter } from './fhir/document-reference'
import { encounterRouter } from './fhir/encounter'
import { buildCapabilityStatement } from './fhir/metadata'
import { organizationRouter } from './fhir/organization'
import { patientRouter } from './fhir/patient'
import { practitionerRouter } from './fhir/practitioner'
import { practitionerRoleRouter } from './fhir/practitioner-role'
import { questionnaireResponseRouter } from './fhir/questionnaire-response'
import { fhirJson } from './fhir/bundle-helpers'
import { operationOutcome } from './fhir/operation-outcome'
import { processBundle } from './fhir/bundle'
import { requireValidBearerToken } from './fhir/auth-middleware'
import { authorizeHandler } from './auth/authorize'
import { jwksHandler } from './auth/jwks'
import { registerHandler } from './auth/register'
import { tokenHandler } from './auth/token'
import { wellKnownSmartConfigurationHandler } from './auth/well-known'
import { createMockState, type MockEhrConfig } from './state'

export type { Defect, DefectSet } from './defects'
export type { MockClientAuthMethod, MockEhrConfig } from './state'

/**
 * Builds an in-memory mock EHR: a SMART authorization server plus a FHIR R4 server, conformant
 * by default and misbehaving only in the ways named in `config.defects`.
 *
 * Returns a `Hono` app — `app.fetch` is a standard `(Request) => Promise<Response>` function,
 * so it can be called directly in-process (tests) or mounted behind a Next.js route handler,
 * with no listening port required either way.
 */
export async function createMockEhr(config: MockEhrConfig): Promise<Hono> {
    const state = await createMockState(config)
    const basePath = new URL(config.baseUrl).pathname
    // `strict: false` so `POST {baseUrl}` and `POST {baseUrl}/` both reach the Bundle route —
    // real clients are inconsistent about a trailing slash on the FHIR service base URL.
    const app = new Hono({ strict: false }).basePath(basePath)

    app.get('/metadata', () => fhirJson(buildCapabilityStatement(state)))
    app.get('/.well-known/smart-configuration', wellKnownSmartConfigurationHandler(state))
    app.get('/.well-known/jwks.json', jwksHandler(state))
    app.get('/authorize', authorizeHandler(state))
    app.post('/token', tokenHandler(state))
    app.post('/register', registerHandler(state))

    app.route('/Patient', patientRouter(state))
    app.route('/Practitioner', practitionerRouter(state))
    app.route('/PractitionerRole', practitionerRoleRouter(state))
    app.route('/Organization', organizationRouter(state))
    app.route('/Encounter', encounterRouter(state))
    app.route('/Condition', conditionRouter(state))
    app.route('/DocumentReference', documentReferenceRouter(state))
    app.route('/Binary', binaryRouter(state))
    app.route('/QuestionnaireResponse', questionnaireResponseRouter(state))

    app.post('/', requireValidBearerToken(state), (c) => processBundle(c, state, app))

    app.notFound((c) =>
        fhirJson(operationOutcome('error', 'not-found', `Unknown resource type or path: ${c.req.path}`), 404),
    )

    return app
}
