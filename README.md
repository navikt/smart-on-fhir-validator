# Nav SMART on FHIR Validator

> [!WARNING]
>
> This tool is for testing only. Point it at test environments, never at production patient data.

## 1. What this is

This is a web app that your EHR launches using a standard [SMART App Launch](https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html)
EHR launch. Instead of showing a clinician a UI, it exercises your SMART and FHIR implementation
(discovery, authorization, tokens, and a set of FHIR reads and writes) and produces a
**validation report**: what conforms, what does not, and the exact HTTP request/response evidence
behind every finding. It checks the
[SMART App Launch](https://hl7.org/fhir/smart-app-launch/STU2.2/) / [FHIR R4](https://hl7.org/fhir/R4/)
specifications and Nav's own requirements for the electronic sick-leave flow ("sykmelding"). Nav
is the Norwegian Labour and Welfare Administration (Arbeids- og velferdsetaten).

It validates against **SMART App Launch 2.2.0** and **FHIR R4**, the versions Nav requires (see
[nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md)).

## 2. What it checks

Every row below is a section in the generated report. "Nav requires" follows Nav's own
[nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md):
**Må** (MUST) or **Bør** (SHOULD).

| Report section                                          | Checks                                                                                                                                                                        | Spec                                                                                                                                                                                                                 | Nav requires |
|---------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| SMART Discovery (`.well-known/smart-configuration`)     | Required/conditional/recommended metadata fields present, endpoints are absolute URLs, PKCE `S256` supported and `plain` rejected                                             | [SMART conformance §metadata](https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html#metadata)                                                                                                              | Må           |
| SMART Capabilities                                      | Advertised `capabilities` satisfy the "Clinician Access for EHR Launch" capability set, `permission-v2` supported                                                             | [SMART conformance §capabilities](https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html#capabilities)                                                                                                      | Må           |
| FHIR Capability Statement (`GET /metadata`)             | Server declares FHIR version R4                                                                                                                                               | [FHIR directory](https://hl7.org/fhir/directory.html)                                                                                                                                                                | Må           |
| Authorization server `aud` enforcement                  | Server rejects an authorization request whose `aud` does not match the FHIR base URL                                                                                          | [SMART app launch](https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html)                                                                                                                                   | Må           |
| Token Response                                          | `scope`, `patient`, `encounter`, `fhirUser`, `refresh_token` present as the granted scopes require                                                                            | [Scopes and launch context](https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html)                                                                                                           | Må / Bør     |
| ID Token                                                | Signature verifies against the issuer's `jwks_uri`; `fhirUser`/`profile` claim present when requested                                                                         | [Scopes and launch context §identity](https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html#scopes-for-requesting-identity-data)                                                             | Må           |
| Scopes                                                  | Granted scopes cover Nav's required set (`openid fhirUser launch patient/Patient.read patient/Encounter.read patient/DocumentReference.read patient/DocumentReference.write`) | [Scope syntax](https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html#fhir-resource-scope-syntax)                                                                                             | Må           |
| Launch Context                                          | `patient`/`encounter` ids and a Practitioner-typed `fhirUser` are usable                                                                                                      | n/a                                                                                                                                                                                                                  | Må           |
| Patient                                                 | Readable by launch-context id; `no-basis-Patient` profile; fødselsnummer or D-nummer identifier                                                                               | [patient.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/patient.md)                                                                                                                                       | Må           |
| Practitioner                                            | Readable by the id in `fhirUser`; `no-basis-Practitioner` profile; HPR-nummer identifier                                                                                      | [practitioner.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/practitioner.md)                                                                                                                             | Må           |
| PractitionerRole                                        | Searchable by `practitioner=`; `no-basis-PractitionerRole` profile                                                                                                            | [nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md)                                                                                                                     | Må           |
| Organization                                            | Readable via the reference discovered from `PractitionerRole.organization`; `no-basis-Organization` profile; organisasjonsnummer, phone                                       | [organization.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/organization.md)                                                                                                                             | Må           |
| Encounter                                               | Readable by launch-context id and searchable by `subject=`; `serviceProvider`, `participant` references                                                                       | [encounter.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/encounter.md)                                                                                                                                   | Må           |
| Condition                                               | Searchable by `subject=`; code from ICD-10, ICPC-2 or ICPC-2B                                                                                                                 | [condition.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/condition.md)                                                                                                                                   | Bør          |
| Write DocumentReference with inline base64 PDF (mechanism 1) | Idempotent `PUT` upsert, round-trip read-back, searchable by `subject=` and `encounter=`                                                                                      | [document-reference.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/document-reference.md)                                                                                                                 | Må           |
| Write Binary, then DocumentReference referencing it (mechanism 2) | Idempotent `PUT` upsert, round-trip read-back, searchable by `subject=` and `encounter=`                                                                                      | [document-reference.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/document-reference.md)                                                                                                                 | Må           |
| Write Binary                                            | `POST` accepted both as a FHIR-JSON resource and as a raw-body upload                                                                                                         | [nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md)                                                                                                                     | Må           |
| Write QuestionnaireResponse                             | Idempotent `PUT` upsert against Nav's canonical Questionnaire, searchable by `subject=`/`encounter=`                                                                          | [questionnaire-response.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/questionnaire-response.md)                                                                                                         | Bør          |
| Submit batch Bundle                                     | `POST` of a `batch` (not `transaction`) Bundle containing both resources above                                                                                                | [bundle.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/bundle.md), [ADR01](https://github.com/navikt/syk-inn/blob/main/docs/adr/ADR01%20-%20FHIR%20resources%20for%20writing%20data%20back%20to%20EHR.md) | Bør          |

## 3. Get your EHR validated, in 4 steps

1. **Register the app** with your authorization server (see [§4](#4-registering-the-app)), or expose a
   `registration_endpoint` in your `.well-known/smart-configuration` so this app can register itself.
2. **Tell us your endpoints.** Your FHIR base URL (the `iss` a launch will supply) and, if you use
   static registration instead of dynamic registration, your issuer/client id.
3. **Launch from your EHR** by configuring its SMART launch URL to point at this app's `/launch`.
4. **Read the report.** The browser is redirected to `/report` automatically once the launch and
   every check complete.

## 4. Registering the app

| Item                | Value                                                              |
| ------------------- | ------------------------------------------------------------------- |
| Launch URL           | `{this app's origin}/launch`                                        |
| Redirect URI         | `{this app's origin}/callback`                                      |
| Requested scopes     | `openid fhirUser launch launch/patient offline_access patient/Patient.rs patient/Practitioner.rs patient/PractitionerRole.rs patient/Organization.rs patient/Encounter.rs patient/Condition.rs patient/DocumentReference.cruds patient/Binary.cruds patient/QuestionnaireResponse.cruds` |
| JWKS URL (for `private_key_jwt`) | `{this app's origin}/.well-known/jwks.json`               |

In Nav's dev environment, `{this app's origin}` is `https://nav-on-fhir.ekstern.dev.nav.no`; locally
it is `http://localhost:3001`.

A vendor whose authorization server grants a narrower set of scopes than requested is not
penalised for it: the Scopes and Launch Context sections report what was granted, not what was
asked for.

### Client authentication

This app supports all three SMART client-authentication types. Configure your issuer under
`SMART_ISSUERS` (a JSON array environment variable, see `src/core/config/issuers.ts`):

**Public (PKCE)**: `authType: "public"`. No client secret. `client_id` travels in the token
request body; PKCE (`S256`) is the only replay protection.

**Symmetric** (`client_secret_basic` or `client_secret_post`): `authType: "symmetric"`, with a
`clientSecretEnv` naming the environment variable that holds the secret. The secret is never
written into configuration, only referenced by variable name.

**Asymmetric** (`private_key_jwt`): `authType: "asymmetric"`, with a `privateKeyJwkEnv` naming the
environment variable holding this app's private key (`RS384` or `ES384`). Register this app's
JWKS URL (`/.well-known/jwks.json`) rather than a static key, so a key rotation does not require
re-registration.

### Dynamic Client Registration (zero-config)

If your authorization server advertises a `registration_endpoint` and no static entry exists for
your issuer in `SMART_ISSUERS`, this app registers itself via
[RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) on first launch, as a public client.
Nothing needs to be configured on this app's side.

## 5. Reading the report

Every finding has a severity:

| Severity  | Meaning                                         |
|-----------|-------------------------------------------------|
| `OK`      | Confirms conformant behaviour.                  |
| `INFO`    | Neutral observation, not a conformance problem. |
| `WARNING` | A SHOULD/RECOMMENDED requirement was not met.   |
| `ERROR`   | A MUST/SHALL requirement was not met.           |

Sections roll findings up into a status: **Passed**, **Passed with warnings**, **Failed**, or
**Not tested**. "Not tested" (`skipped`) is its own status, never folded into a pass: it means a
check could not run. The FHIR read probes need a `patient` id from launch context, so if your
token response omits one, every probe that depends on it is reported as "Not tested", not
"Passed". A report is never a plain pass while anything in it is "Not tested".

Every finding cites the spec paragraph it checks (HL7, the Norwegian `no-basis` profiles on
Simplifier, and/or Nav's own docs) and can be expanded to show the raw HTTP request and response
that produced it. The mock EHR ([§8](#8-running-it-locally)) is conformant by default, but can
simulate a specific non-conformance (see `src/mocks/defects.ts`):

```sh
MOCK_EHR_DEFECTS=organization-missing-orgnr yarn dev
```

Launching against that mock and re-running the report produces:

```
ERROR  Organization/organization-magnar-legekontor has no identifier from the organisasjonsnummer/ENH
       system `urn:oid:2.16.578.1.12.4.1.4.101`; Nav uses this to identify the sykmelder's organisation.
   ↳ GET http://localhost:3001/api/mocks/fhir/Organization/organization-magnar-legekontor
     200 OK  Organization
     {
       "resourceType": "Organization",
       "id": "organization-magnar-legekontor",
       "meta": { "profile": ["http://hl7.no/fhir/StructureDefinition/no-basis-Organization"] },
       "name": "Magnar Legekontor AS",
       "telecom": [ ... ]
     }
```

The full report is downloadable as JSON ("Download full report as JSON" on the report page, or
`GET /report/download`) and can be attached verbatim to a support ticket.

## 6. Requirements checklist

### Read (pre-filling a sykmelding from your EHR)

Every resource below must be reachable using **only** the ids the launch hands over: the
`patient`/`encounter` token-response parameters and the `fhirUser` id_token claim. If a resource
can only be found some other way (a hardcoded id, a separate lookup UI), Nav cannot pre-fill from
it.

| Resource         | Required search/read                                                                              | Norwegian identifier                                                                          |
|------------------|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Patient          | `GET [base]/Patient/{patient-id-from-launch}`                                                     | Fødselsnummer (`urn:oid:2.16.578.1.12.4.1.4.1`) or D-nummer (`urn:oid:2.16.578.1.12.4.1.4.2`) |
| Practitioner     | `GET [base]/Practitioner/{id-from-fhirUser}`                                                      | HPR-nummer (`urn:oid:2.16.578.1.12.4.1.4.4`)                                                  |
| PractitionerRole | `GET [base]/PractitionerRole?practitioner=Practitioner/{id}`                                      | n/a                                                                                           |
| Organization     | `GET [base]/Organization/{id}` (id taken from `PractitionerRole.organization`)                    | Organisasjonsnummer (`urn:oid:2.16.578.1.12.4.1.4.101`)                                       |
| Encounter        | `GET [base]/Encounter/{encounter-id-from-launch}` and `GET [base]/Encounter?subject=Patient/{id}` | n/a                                                                                           |
| Condition (Bør)  | `GET [base]/Condition?subject=Patient/{id}`                                                       | ICD-10 (`.7110`), ICPC-2 (`.7170`) or ICPC-2B (`.7171`)                                       |

Diagnosis and document-type codes use OIDs under Helsedirektoratet's `2.16.578.1.12.4.1` arc. See
[nav-requirements.md §Kodeverk](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md#kodeverk)
for the full table.

### Write (sending the sykmelding back to your EHR)

| Resource                                | Mechanism                                                                                                                                                                                                                                                                                                                                                                                       | Nav requires |
|-----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| DocumentReference (the PDF)             | `PUT [base]/DocumentReference/{sykmelding-id}` with a client-assigned id, idempotent upsert. Content either inline base64 (`content[0].attachment.data`) or by reference to a `Binary` (`content[0].attachment.url`). Must declare `type.coding` with system `urn:oid:2.16.578.1.12.4.1.1.9602` code `J01-2` ("Sykmeldinger og trygdesaker"), and must be searchable by `subject=` and `encounter=`. | Må           |
| Binary (the PDF bytes)                  | `POST [base]/Binary`, accepted either as a FHIR-JSON resource or as a raw upload with the PDF's own `Content-Type`.                                                                                                                                                                                                                                                                             | Må           |
| QuestionnaireResponse (structured data) | `PUT [base]/QuestionnaireResponse/{sykmelding-id}` (same id as the DocumentReference), referencing Nav's canonical Questionnaire (`https://www.nav.no/samarbeidspartner/sykmelding/fhir/R4/Questionnaire/V1`).                                                                                                                                                                                  | Bør          |
| Bundle (both together)                  | `POST [base]/` (the FHIR base URL) with `Bundle.type = "batch"`, each entry a `PUT` to its own client-assigned id.                                                                                                                                                                                                                                                                              | Bør          |

**Why `batch`, not `transaction`:** a `transaction` Bundle is atomic, so if any entry fails the
server rolls back everything, including entries that succeeded. Norwegian health institutions are
under a legal duty to file the sykmelding PDF in the patient's journal ("journalføringsplikten").
If the structured `QuestionnaireResponse` entry failed inside a `transaction`, the duty-bound
`DocumentReference` would be rolled back with it. A `batch` Bundle processes each entry
independently. See
[ADR01](https://github.com/navikt/syk-inn/blob/main/docs/adr/ADR01%20-%20FHIR%20resources%20for%20writing%20data%20back%20to%20EHR.md)
for the full reasoning. Each entry uses `PUT` for the same reason `PUT` is used outside a Bundle:
the sykmelding id is known up front, so the write is idempotent and
`DocumentReference.context.related` can reference the `QuestionnaireResponse` by that id before
either resource exists on the server.

## 7. Troubleshooting

Every row below is a check this app runs. `src/mocks/defects.ts` is the catalogue of deliberate
non-conformances the test suite uses to prove each one is detected.

| Symptom                                                  | What the report says                                                                                                                                                | Fix                                                                          |
|----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| `.well-known/smart-configuration` returns 404            | The launch fails before any report exists (`/launch/error`)                                                                                                         | Expose the well-known document at your FHIR base URL.                        |
| `code_challenge_methods_supported` missing               | Discovery: `ERROR`, "`code_challenge_methods_supported` is missing"                                                                                                | Advertise it, including `S256`.                                              |
| `code_challenge_methods_supported` includes `plain`      | Discovery: `ERROR`, "...includes `plain`, which SHALL NOT be supported"                                                                                            | Remove `plain`; only `S256` may be offered.                                  |
| Authorization server does not enforce `aud`              | Authorization server `aud` enforcement: `ERROR`, "did NOT reject an authorization request whose `aud` parameter deliberately did not match"                        | Reject an authorize request whose `aud` does not equal your FHIR base URL.   |
| `launch`/`launch/patient` scope not honoured             | Token Response: `ERROR`, "`patient` is missing from the token response, even though a `launch` or `launch/patient` scope was requested"; Launch Context: `WARNING` | Return `patient` in the token response when that scope was granted.          |
| `fhirUser` (or `profile`) absent from the id_token       | ID Token: `ERROR`, "The id_token has neither a `fhirUser` nor a `profile` claim"                                                                                   | Add a `fhirUser` claim referencing the authenticated Practitioner.           |
| id_token signed for the wrong audience or expired        | ID Token: `ERROR`, "...ERR_JWT_CLAIM_VALIDATION_FAILED" / "...ERR_JWT_EXPIRED"                                                                                     | Set `aud` to this app's `client_id` and a sane `exp`.                        |
| A write-back resource isn't searchable by launch context | Write DocumentReference: `ERROR`, "A written DocumentReference must be findable by \"subject\""                                                                    | Implement `subject=`/`encounter=` search for the written resource type.      |
| Server only accepts `transaction`, not `batch`           | Submit batch Bundle: `ERROR`, "This server only accepts transaction Bundles, not batch"                                                                            | Support `Bundle.type = "batch"` (see [§6](#6-requirements-checklist)).       |
| `offline_access` requested but no `refresh_token` issued | Token Response: `WARNING`, "`refresh_token` is missing...even though `offline_access`"                                                                             | Issue a refresh token when `offline_access` is granted.                      |
| Patient has no fødselsnummer/D-nummer identifier         | Patient: `ERROR`, no recognised identifier system                                                                                                                  | Add an `identifier` with system `urn:oid:2.16.578.1.12.4.1.4.1` (or `.4.2`). |

## 8. Running it locally

```sh
yarn install
yarn dev
```

Open <http://localhost:3001>. In any non-production build, this app runs an in-repo mock EHR (see
`src/app/mock-ehr-enabled.ts` and `src/app/api/mocks/fhir/[[...path]]/route.ts`), so the landing
page shows a **"Try it against the built-in mock EHR"** button. It launches the same code path a
real EHR would, against `iss=http://localhost:3001/api/mocks/fhir`:

```
GET /launch?iss=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmocks%2Ffhir&launch=demo
```

The mock is conformant by default: a clean run produces zero `ERROR` findings, only a few
`WARNING`/`INFO` findings on optional and recommended checks. This is asserted by the
`baseline: the fully conformant mock` test in `src/validation/defects.integration.ts`. If your own
server produces errors the mock does not, the problem is in your server rather than in these
validators. The mock can also simulate specific non-conformances (see `src/mocks/defects.ts` and
[§5](#5-reading-the-report)).

### Tests

```sh
yarn test              # unit tests
yarn test:integration   # integration tests, including the full defect catalogue against the mock EHR
yarn e2e:install        # one-time: installs the Playwright browser
yarn e2e                # end-to-end smoke test: launch → callback → report, in a real browser
```

## 9. For Nav developers / architecture

This app is deployed on [nais](https://doc.nais.io/) (see `.nais/nais-dev.yaml`), backed by
[Valkey](https://valkey.io/) for session and report storage that survives a pod restart and is
visible from either replica.

### Signing key

This app signs with its own key for `private_key_jwt` client authentication and publishes the
public half at `/.well-known/jwks.json`. Generate one with:

```sh
yarn generate-key
```

This prints a single JSON line. Set it as `SMART_PRIVATE_JWK` in the deployed environment's secret
(`smart-on-fhir-validator-clients`) — never commit it. Without it, `src/core/smart/jwks.ts`
generates an ephemeral key at startup, which does not survive a restart and forces any EHR that
pinned this app's public key to re-register.

Every outbound HTTP call this app makes is recorded as a redacted `HttpExchange`
(`src/core/http/exchange.ts`, `src/core/http/redact.ts`), with credentials stripped at recording
time rather than at render time. Every validator (`src/validation/**`) is a pure function over
that recorded evidence, which is how each finding can show the exchange that produced it.

Tokens never reach the browser. The session cookie carries only an opaque, `HttpOnly` session id
(`src/core/session/session-cookie.ts`); the access token, refresh token and id_token live only in
server-side session storage. The callback handler (`src/app/callback/route.ts`) runs the entire
validation run, including every write probe, exactly once, server-side, before the browser is
redirected to `/report`.
