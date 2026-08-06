import type { JSONWebKeySet } from 'jose'

import type {
    Binary,
    Condition,
    DocumentReference,
    Encounter,
    Organization,
    Patient,
    Practitioner,
    PractitionerRole,
    QuestionnaireResponse,
} from 'fhir/r4'

import { createCondition } from './data/condition'
import { createSeedBinary, createSeedDocumentReference } from './data/document-reference'
import { createEncounter } from './data/encounter'
import { createOrganization } from './data/organization'
import { createPatient } from './data/patient'
import { createPractitioner } from './data/practitioner'
import { createPractitionerRole } from './data/practitioner-role'
import { createSeedQuestionnaireResponse } from './data/questionnaire-response'
import { createDefectSet, type Defect, type DefectSet } from './defects'
import { createMockSigningIdentity, type MockSigningIdentity } from './keys'

export type MockClientAuthMethod = 'public' | 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt'

export type MockEhrConfig = {
    /** The FHIR base URL this instance serves, e.g. `https://mock-ehr.example/fhir`. */
    baseUrl: string
    defects?: Defect[]
    clientAuth?: MockClientAuthMethod
    clientId?: string
    /** Required when `clientAuth` is a shared-secret method. */
    clientSecret?: string
    /**
     * The client's own public JWKS, required to verify `private_key_jwt` assertions in-process
     * without a network round trip. A client may also register one dynamically via `POST /register`.
     */
    clientJwks?: JSONWebKeySet
}

export type RegisteredClient = {
    clientId: string
    authMethod: MockClientAuthMethod
    clientSecret?: string
    jwks?: JSONWebKeySet
    redirectUris?: string[]
}

export type AuthorizationCodeRecord = {
    clientId: string
    redirectUri: string
    scope: string
    codeChallenge: string
    codeChallengeMethod: string
    used: boolean
}

export type AccessTokenRecord = {
    clientId: string
    scope: string[]
    patient: string
    encounter: string
    fhirUser: string
    expiresAt: number
}

export type RefreshTokenRecord = {
    clientId: string
    scope: string[]
    patient: string
    encounter: string
    fhirUser: string
}

export type MockState = {
    baseUrl: string
    clientAuth: MockClientAuthMethod
    defects: DefectSet
    signing: MockSigningIdentity
    clients: Map<string, RegisteredClient>
    authorizationCodes: Map<string, AuthorizationCodeRecord>
    accessTokens: Map<string, AccessTokenRecord>
    refreshTokens: Map<string, RefreshTokenRecord>
    /** `jti` values already seen on a `private_key_jwt` client assertion, to reject replay. */
    usedAssertionIds: Set<string>
    resources: {
        Patient: Map<string, Patient>
        Practitioner: Map<string, Practitioner>
        PractitionerRole: Map<string, PractitionerRole>
        Organization: Map<string, Organization>
        Encounter: Map<string, Encounter>
        Condition: Map<string, Condition>
        DocumentReference: Map<string, DocumentReference>
        Binary: Map<string, Binary>
        QuestionnaireResponse: Map<string, QuestionnaireResponse>
    }
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

export async function createMockState(config: MockEhrConfig): Promise<MockState> {
    const defects = createDefectSet(config.defects)
    const signing = await createMockSigningIdentity()

    const clients = new Map<string, RegisteredClient>()
    if (config.clientId) {
        clients.set(config.clientId, {
            clientId: config.clientId,
            authMethod: config.clientAuth ?? 'public',
            clientSecret: config.clientSecret,
            jwks: config.clientJwks,
        })
    }

    const patient = createPatient(defects)
    const practitioner = createPractitioner(defects)
    const organization = createOrganization(defects)
    const encounter = createEncounter(defects)
    const condition = createCondition(defects)
    const practitionerRole = createPractitionerRole()
    const documentReference = createSeedDocumentReference()
    const binary = createSeedBinary()
    const questionnaireResponse = createSeedQuestionnaireResponse()

    return {
        baseUrl: normalizeBaseUrl(config.baseUrl),
        clientAuth: config.clientAuth ?? 'public',
        defects,
        signing,
        clients,
        authorizationCodes: new Map(),
        accessTokens: new Map(),
        refreshTokens: new Map(),
        usedAssertionIds: new Set(),
        resources: {
            Patient: new Map([[patient.id!, patient]]),
            Practitioner: new Map([[practitioner.id!, practitioner]]),
            PractitionerRole: new Map([[practitionerRole.id!, practitionerRole]]),
            Organization: new Map([[organization.id!, organization]]),
            Encounter: new Map([[encounter.id!, encounter]]),
            Condition: new Map([[condition.id!, condition]]),
            DocumentReference: new Map([[documentReference.id!, documentReference]]),
            Binary: new Map([[binary.id!, binary]]),
            QuestionnaireResponse: new Map([[questionnaireResponse.id!, questionnaireResponse]]),
        },
    }
}
