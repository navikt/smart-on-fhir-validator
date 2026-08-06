# Nav SMART on FHIR Validator

$${\color{red}THIS \space TOOL \space IS \space FOR \space TESTING \space ONLY. \space POINT \space IT \space AT \space TEST \space ENVIRONMENTS, \space NEVER \space AT \space PRODUCTION \space PATIENT \space DATA.}$$

## 1. What this is

This is a web app that your EHR launches using a standard [SMART App Launch](https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html)
EHR launch — the same way it would launch any other SMART app. Instead of showing a clinician a
UI, it exercises your SMART and FHIR implementation (discovery, authorization, tokens, and a set
of FHIR reads and writes) and produces a **validation report**: what conforms, what does not, and
the exact HTTP request/response evidence behind every finding. It checks both the
[SMART App Launch](https://build.fhir.org/ig/HL7/smart-app-launch/) / [FHIR R4](https://hl7.org/fhir/R4/)
specifications and Nav's own requirements for the electronic sick-leave flow ("sykmelding") — Nav
is the Norwegian Labour and Welfare Administration (Arbeids- og velferdsetaten).

It validates against **SMART App Launch 2.2.0** and **FHIR R4**, the versions Nav requires (see
[nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md)).

## 2. What it checks

Every row below is a section in the generated report. "Nav requires" follows Nav's own
[nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md):
**Må** (MUST) or **Bør** (SHOULD).

| Report section                                    | Checks                                                                                             | Spec                                                                                                          | Nav requires |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------- |
| SMART Discovery (`.well-known/smart-configuration`) | Required/conditional/recommended metadata fields present, endpoints are absolute URLs, PKCE `S256` supported and `plain` rejected | [SMART conformance §metadata](https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html#metadata)      | Må            |
| SMART Capabilities                                  | Advertised `capabilities` satisfy the "Clinician Access for EHR Launch" capability set, `permission-v2` supported | [SMART conformance §capabilities](https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html#capabilities) | Må            |
| FHIR Capability Statement (`GET /metadata`)         | Server declares FHIR version R4                                                                       | [FHIR directory](https://hl7.org/fhir/directory.html)                                                          | Må            |
| Authorization server `aud` enforcement              | Server rejects an authorization request whose `aud` does not match the FHIR base URL                  | [SMART app launch](https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html)                             | Må            |
| Token Response                                      | `scope`, `patient`, `encounter`, `fhirUser`, `refresh_token` present as the granted scopes require     | [Scopes and launch context](https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html)     | Må / Bør      |
| ID Token                                            | Signature verifies against the issuer's `jwks_uri`; `fhirUser`/`profile` claim present when requested | [Scopes and launch context §identity](https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html#scopes-for-requesting-identity-data) | Må            |
| Scopes                                              | Granted scopes cover Nav's required set (`openid fhirUser launch patient/Patient.read patient/Encounter.read patient/DocumentReference.read patient/DocumentReference.write`) | [Scope syntax](https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html#fhir-resource-scope-syntax) | Må            |
| Launch Context                                      | `patient`/`encounter` ids and a Practitioner-typed `fhirUser` are usable                               | —                                                                                                               | Må            |
| Patient                                              | Readable by launch-context id; `no-basis-Patient` profile; fødselsnummer or D-nummer identifier         | [patient.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/patient.md)                                 | Må            |
| Practitioner                                         | Readable by the id in `fhirUser`; `no-basis-Practitioner` profile; HPR-nummer identifier                | [practitioner.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/practitioner.md)                       | Må            |
| PractitionerRole                                     | Searchable by `practitioner=`; `no-basis-PractitionerRole` profile                                       | [nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md)                | Må            |
| Organization                                         | Readable via the reference discovered from `PractitionerRole.organization`; `no-basis-Organization` profile; organisasjonsnummer, phone | [organization.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/organization.md)                       | Må            |
| Encounter                                            | Readable by launch-context id and searchable by `subject=`; `serviceProvider`, `participant` references | [encounter.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/encounter.md)                             | Må            |
| Condition                                            | Searchable by `subject=`; code from ICD-10, ICPC-2 or ICPC-2B                                            | [condition.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/condition.md)                             | Bør           |
| Write DocumentReference (inline PDF / Binary reference) | Idempotent `PUT` upsert, round-trip read-back, searchable by `subject=` and `encounter=`             | [document-reference.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/document-reference.md)           | Må            |
| Write Binary                                         | `POST` accepted both as a FHIR-JSON resource and as a raw-body upload                                    | [nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md)                | Må            |
| Write QuestionnaireResponse                          | Idempotent `PUT` upsert against Nav's canonical Questionnaire, searchable by `subject=`/`encounter=`      | [questionnaire-response.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/questionnaire-response.md)   | Bør           |
| Submit batch Bundle                                  | `POST` of a `batch` (not `transaction`) Bundle containing both resources above                            | [bundle.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/bundle.md), [ADR01](https://github.com/navikt/syk-inn/blob/main/docs/adr/ADR01%20-%20FHIR%20resources%20for%20writing%20data%20back%20to%20EHR.md) | Bør           |

## 3. Get your EHR validated — 4 steps

1. **Register the app** with your authorization server (see [§4](#4-registering-the-app)), or expose a
   `registration_endpoint` in your `.well-known/smart-configuration` so this app can register itself.
2. **Tell us your endpoints** — your FHIR base URL (the `iss` a launch will supply) and, if you use
   static registration instead of dynamic registration, your issuer/client id.
3. **Launch from your EHR** by configuring its SMART launch URL to point at this app's `/launch`.
4. **Read the report** — the browser is redirected to `/report` automatically once the launch and
   every check complete.

## 4. Registering the app

| Item                | Value                                                              |
| ------------------- | ------------------------------------------------------------------- |
| Launch URL           | `{this app's origin}/launch`                                        |
| Redirect URI         | `{this app's origin}/callback`                                      |
| Requested scopes     | `openid fhirUser launch launch/patient offline_access patient/Patient.rs patient/Practitioner.rs patient/PractitionerRole.rs patient/Organization.rs patient/Encounter.rs patient/Condition.rs patient/DocumentReference.cruds patient/Binary.cruds patient/QuestionnaireResponse.cruds` |
| JWKS URL (for `private_key_jwt`) | `{this app's origin}/.well-known/jwks.json`               |

In Nav's dev environment, `{this app's origin}` is `https://nav-on-fhir.ekstern.dev.nav.no`; locally
it is `http://localhost:3000`.

A vendor whose authorization server grants a narrower set of scopes than requested is not
penalised for it — the report's Scopes and Launch Context sections check what was actually
granted, not what was asked for.

### Client authentication

This app supports all three SMART client-authentication types. Configure your issuer under
`SMART_ISSUERS` (a JSON array environment variable, see `src/core/config/issuers.ts`):

**Public (PKCE)** — `authType: "public"`. No client secret. `client_id` travels in the token
request body; PKCE (`S256`) is the only replay protection.

**Symmetric** (`client_secret_basic` or `client_secret_post`) — `authType: "symmetric"`, with a
`clientSecretEnv` naming the environment variable that holds the secret. The secret itself is
never written into configuration, only referenced by variable name.

**Asymmetric** (`private_key_jwt`) — `authType: "asymmetric"`, with a `privateKeyJwkEnv` naming the
environment variable holding this app's own private key (`RS384` or `ES384`). Register this app's
JWKS URL — `/.well-known/jwks.json` — rather than a static key, so a key rotation does not require
you to re-register anything.

### Dynamic Client Registration (zero-config)

If your authorization server advertises a `registration_endpoint` and no static entry exists for
your issuer in `SMART_ISSUERS`, this app registers itself automatically via
[RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) on first launch, as a public client. This
is the fastest path to a first validation run: nothing needs to be configured on this app's side at
all.

## 5. Reading the report

Every finding has a severity:

| Severity  | Meaning                                                        |
| --------- | ----------------------------------------------------------------- |
| `OK`      | Confirms conformant behaviour.                                    |
| `INFO`    | Neutral observation, not a conformance problem.                   |
| `WARNING` | A SHOULD/RECOMMENDED requirement was not met.                      |
| `ERROR`   | A MUST/SHALL requirement was not met.                              |

Sections roll findings up into a status: **Passed**, **Passed with warnings**, **Failed**, or
**Not tested**. "Not tested" (`skipped`) is its own status, never folded into a pass: it means a
check could not run at all — for example, the FHIR read probes need a `patient` id from launch
context, so if your token response omits one, every probe that depends on it is reported as "Not
tested", not "Passed". A report is never a plain pass while anything in it is "Not tested".

Every finding cites the exact spec paragraph it checks (HL7, the Norwegian `no-basis` profiles on
Simplifier, and/or Nav's own docs) and can be expanded to show the raw HTTP request and response
that produced it — real evidence, not just a claim. Here is an actual finding from a run against
this app's own mock EHR:

```
ERROR  PractitionerRole/practitioner-role-sidsel-jarvery does not declare `meta.profile` of
       `http://hl7.no/fhir/StructureDefinition/no-basis-PractitionerRole`; the no-basis-PractitionerRole
       profile requires it.
   ↳ GET http://localhost:3000/api/mocks/fhir/PractitionerRole?practitioner=Practitioner/practitioner-sidsel-jarvery
     200 OK — Bundle (searchset, total: 1)
```

The full report is also downloadable as JSON (a "Download full report as JSON" link on the report
page, or `GET /report/download`) — useful to attach verbatim to a support ticket.

## 6. Requirements checklist

### Read (pre-filling a sykmelding from your EHR)

Every resource below must be reachable using **only** the ids the launch itself hands over — the
`patient`/`encounter` token-response parameters and the `fhirUser` id_token claim. If a resource
can only be found some other way (a hardcoded id, a separate lookup UI), Nav cannot pre-fill from
it.

| Resource         | Required search/read                                                | Norwegian identifier                                     |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Patient            | `GET [base]/Patient/{patient-id-from-launch}`                          | Fødselsnummer (`urn:oid:2.16.578.1.12.4.1.4.1`) or D-nummer (`urn:oid:2.16.578.1.12.4.1.4.2`) |
| Practitioner        | `GET [base]/Practitioner/{id-from-fhirUser}`                            | HPR-nummer (`urn:oid:2.16.578.1.12.4.1.4.4`)                  |
| PractitionerRole    | `GET [base]/PractitionerRole?practitioner=Practitioner/{id}`             | —                                                              |
| Organization        | `GET [base]/Organization/{id}` (id taken from `PractitionerRole.organization`) | Organisasjonsnummer (`urn:oid:2.16.578.1.12.4.1.4.101`) |
| Encounter           | `GET [base]/Encounter/{encounter-id-from-launch}` and `GET [base]/Encounter?subject=Patient/{id}` | —                                       |
| Condition (Bør)     | `GET [base]/Condition?subject=Patient/{id}`                             | ICD-10 (`.7110`), ICPC-2 (`.7170`) or ICPC-2B (`.7171`)      |

Diagnosis and document-type codes use OIDs under Helsedirektoratet's `2.16.578.1.12.4.1` arc — see
[nav-requirements.md §Kodeverk](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md#kodeverk)
for the full table.

### Write (sending the sykmelding back to your EHR)

| Resource                        | Mechanism                                                                      | Nav requires |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------- |
| DocumentReference (the PDF)        | `PUT [base]/DocumentReference/{sykmelding-id}` — client-assigned id, idempotent upsert. Content either inline base64 (`content[0].attachment.data`) or by reference to a `Binary` (`content[0].attachment.url`). Must declare `type.coding` with system `urn:oid:2.16.578.1.12.4.1.1.9602` code `J01-2` ("Sykmeldinger og trygdesaker"), and must be searchable by `subject=` and `encounter=`. | Må |
| Binary (the PDF bytes)             | `POST [base]/Binary`, accepted either as a FHIR-JSON resource or as a raw upload with the PDF's own `Content-Type`. | Må |
| QuestionnaireResponse (structured data) | `PUT [base]/QuestionnaireResponse/{sykmelding-id}` (same id as the DocumentReference), referencing Nav's canonical Questionnaire (`https://www.nav.no/samarbeidspartner/sykmelding/fhir/R4/Questionnaire/V1`). | Bør |
| Bundle (both together)             | `POST [base]/` (the FHIR base URL) with `Bundle.type = "batch"`, each entry a `PUT` to its own client-assigned id. | Bør |

**Why `batch`, not `transaction`:** a `transaction` Bundle is atomic — if any entry fails, the FHIR
server rolls back everything, including entries that succeeded. Norwegian health institutions are
under a legal duty to file the sykmelding PDF in the patient's journal
("journalføringsplikten"). If the structured `QuestionnaireResponse` entry failed inside an atomic
`transaction`, that duty-bound `DocumentReference` would be rolled back too and never get filed —
even though the PDF write itself succeeded. A `batch` Bundle processes each entry independently:
the DocumentReference is stored regardless of what happens to the QuestionnaireResponse. See
[ADR01](https://github.com/navikt/syk-inn/blob/main/docs/adr/ADR01%20-%20FHIR%20resources%20for%20writing%20data%20back%20to%20EHR.md)
for the full reasoning. Each entry uses `PUT` rather than `POST` for the same reason `PUT` is used
outside a Bundle: the sykmelding id is known up front, so the write is idempotent and
`DocumentReference.context.related` can reference the `QuestionnaireResponse` by that id before
either resource exists on the server.

## 7. Troubleshooting

These are real, checked failures — every row below is a validator this app actually runs (see
`src/mocks/defects.ts`, the catalogue of deliberate non-conformances this app's own test suite
proves each validator detects).

| Symptom                                              | What the report says                                                                          | Fix                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `.well-known/smart-configuration` returns 404          | The launch fails before any report exists (`/launch/error`)                                       | Expose the well-known document at your FHIR base URL.                  |
| `code_challenge_methods_supported` missing              | Discovery: `ERROR` — "`code_challenge_methods_supported` is missing"                              | Advertise it, including `S256`.                                        |
| `code_challenge_methods_supported` includes `plain`     | Discovery: `ERROR` — "...includes `plain`, which SHALL NOT be supported"                          | Remove `plain`; only `S256` may be offered.                            |
| Authorization server does not enforce `aud`             | Authorization server `aud` enforcement: `ERROR` — "did NOT reject an authorization request whose `aud` parameter deliberately did not match" | Reject an authorize request whose `aud` does not equal your FHIR base URL. |
| `launch`/`launch/patient` scope not honoured            | Token Response: `ERROR` — "`patient` is missing from the token response, even though a `launch` or `launch/patient` scope was requested"; Launch Context: `WARNING` | Return `patient` in the token response when that scope was granted.    |
| `fhirUser` (or `profile`) absent from the id_token      | ID Token: `ERROR` — "The id_token has neither a `fhirUser` nor a `profile` claim"                 | Add a `fhirUser` claim referencing the authenticated Practitioner.       |
| id_token signed for the wrong audience or expired        | ID Token: `ERROR` — "...ERR_JWT_CLAIM_VALIDATION_FAILED" / "...ERR_JWT_EXPIRED"                    | Set `aud` to this app's `client_id` and a sane `exp`.                   |
| A write-back resource isn't searchable by launch context | Write DocumentReference: `ERROR` — "A written DocumentReference must be findable by \"subject\"" | Implement `subject=`/`encounter=` search for the written resource type. |
| Server only accepts `transaction`, not `batch`            | Submit batch Bundle: `ERROR` — "This server only accepts transaction Bundles, not batch"           | Support `Bundle.type = "batch"` (see [§6](#6-requirements-checklist)).  |
| `offline_access` requested but no `refresh_token` issued  | Token Response: `WARNING` — "`refresh_token` is missing...even though `offline_access`"            | Issue a refresh token when `offline_access` is granted.                 |
| Patient has no fødselsnummer/D-nummer identifier          | Patient: `ERROR` — no recognised identifier system                                                 | Add an `identifier` with system `urn:oid:2.16.578.1.12.4.1.4.1` (or `.4.2`). |

## 8. Running it locally

```sh
yarn install
yarn dev
```

Open <http://localhost:3000>. In any non-production build, this app runs an in-repo mock EHR (see
`src/app/mock-ehr-enabled.ts` and `src/app/api/mocks/fhir/[[...path]]/route.ts`), so the landing
page shows a **"Try it against the built-in mock EHR"** button — click it to see a real, complete
report in under a minute with no registration at all. It launches the same code path as a real
EHR would, against `iss=http://localhost:3000/api/mocks/fhir`:

```
GET /launch?iss=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmocks%2Ffhir&launch=demo
```

That mock is designed to be conformant by default — a good baseline before pointing this tool at
your own server. At the time of writing it still has a few known, tracked bugs of its own (see
`KNOWN_BASELINE_MOCK_BUGS` in `src/validation/defects.integration.ts`), so a handful of `ERROR`
findings against the mock are expected and does not mean this app's validators are wrong.

### Tests

```sh
yarn test              # unit tests
yarn test:integration   # integration tests, including the full defect catalogue against the mock EHR
yarn e2e:install        # one-time: installs the Playwright browser
yarn e2e                # end-to-end smoke test: launch → callback → report, in a real browser
```

## 9. For Nav developers / architecture

This app is deployed on [nais](https://doc.nais.io/) (see `.nais/app.yaml`), backed by
[Valkey](https://valkey.io/) for session and report storage that survives a pod restart and is
visible from either replica.

The core architectural idea: every outbound HTTP call this app makes is recorded as a redacted
`HttpExchange` (`src/core/http/exchange.ts`, `src/core/http/redact.ts`) — credentials stripped at
the moment of recording, never at render time — and every validator (`src/validation/**`) is a
pure function over that recorded evidence. That is why every finding in the report can show its
own proof: the finding and the exchange it came from are two views of the same data.

Tokens never reach the browser. The session cookie carries only an opaque, `HttpOnly` session id
(`src/core/session/session-cookie.ts`); the access token, refresh token, and id_token live only in
server-side session storage, and the callback handler (`src/app/callback/route.ts`) runs the
entire validation run — including every write probe — exactly once, server-side, before the
browser is ever redirected to `/report`.
