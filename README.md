# Nav SMART on FHIR Validator

> [!WARNING]
>
> This tool is for testing only. Point it at test environments, never at production patient data.

## What this is

This is a web app that your EHR launches using a standard [SMART App Launch](https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html)
EHR launch. Instead of showing a clinician a UI, it exercises your SMART and FHIR implementation
(discovery, authorization, tokens, and a set of FHIR reads and writes) and produces a
**validation report**: what conforms, what does not, and the exact HTTP request/response evidence
behind every finding. It validates against **SMART App Launch 2.2.0** and **FHIR R4** (the
[SMART App Launch](https://hl7.org/fhir/smart-app-launch/STU2.2/) / [FHIR R4](https://hl7.org/fhir/R4/)
specifications), the versions Nav requires (see
[nav-requirements.md](https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md))
for the electronic sick-leave flow ("sykmelding"). Nav is the Norwegian Labour and Welfare
Administration (Arbeids- og velferdsetaten). See [docs/requirements.md](docs/requirements.md) for
exactly what each report section checks.

## Register your EHR

To get validated: **register the app** (below), or expose a `registration_endpoint` for dynamic
registration; **tell us your FHIR base URL** (and issuer/client id, for static registration);
**launch from your EHR** at this app's `/launch`; then **read the report** at `/report`.

| Item                              | Value                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch URL                         | `{this app's origin}/launch`                                                                                                                                                                                                                                    |
| Redirect URI                       | `{this app's origin}/callback`                                                                                                                                                                                                                                   |
| Requested scopes                   | `openid fhirUser launch launch/patient offline_access patient/Patient.rs patient/Practitioner.rs patient/PractitionerRole.rs patient/Organization.rs patient/Encounter.rs patient/Condition.rs patient/DocumentReference.cruds patient/Binary.cruds patient/QuestionnaireResponse.cruds` |
| JWKS URL (for `private_key_jwt`)   | `{this app's origin}/.well-known/jwks.json`                                                                                                                                                                                                                     |

In Nav's dev environment, `{this app's origin}` is `https://nav-on-fhir.ekstern.dev.nav.no`; locally
it is `http://localhost:3001`. A vendor whose authorization server grants a narrower set of scopes
than requested is not penalised for it: the Scopes and Launch Context sections report what was
granted, not what was asked for.

### Client authentication

This app supports all three SMART client-authentication types. Register your issuer by opening a
pull request that adds one entry to the `SMART_ISSUERS` array in
[`.nais/nais-dev.yaml`](.nais/nais-dev.yaml) (schema: `src/core/config/issuers.ts`). Every field is
a name or public identifier, never a secret, so this is safe to edit directly in the GitHub web UI:

- **Public (PKCE)**: `authType: "public"`. No client secret; PKCE (`S256`) is the only replay
  protection.
- **Symmetric** (`client_secret_basic`/`client_secret_post`): `authType: "symmetric"`, plus a
  `clientSecretEnv` naming the environment variable holding the secret. Must match
  `SMART_CLIENT_SECRET_<NAME>`, so an entry can never name an unrelated variable. The secret value
  itself never goes in the manifest; ask us to set it once your PR is open.
- **Asymmetric** (`private_key_jwt`): `authType: "asymmetric"`. No further fields: this app has one
  signing identity (`SMART_PRIVATE_JWK`, see [For Nav developers](#for-nav-developers--architecture)),
  published at `/.well-known/jwks.json`, so register this app's JWKS URL rather than a static key.

If your authorization server advertises a `registration_endpoint` instead, and no static entry
exists for your issuer, this app registers itself via
[RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) on first launch, as a public client, with
nothing to configure on this app's side.

Your pull request is checked automatically: CI parses `SMART_ISSUERS` out of the manifest through
the same schema the app uses at startup (`src/core/config/manifest-issuers.test.ts`), so a
malformed entry fails your PR, not the deployment (run it yourself with `yarn test`).

### Network access (egress allowlist)

Nav's cluster only permits outbound connections from this app to an explicit allowlist
(`spec.accessPolicy.outbound.external` in [`.nais/nais-dev.yaml`](.nais/nais-dev.yaml)). Your FHIR
base URL, authorization endpoint, token endpoint, and JWKS URI can each live on a *different*
hostname, for example `authserver.vendor.com` vs `fhir.vendor.com` vs `token.vendor.com`.

**In the same pull request as your `SMART_ISSUERS` entry, add every server-side hostname your
integration touches to that allowlist.** An entry naming only your FHIR base URL will parse fine
and pass CI, then fail at runtime with an egress-blocked connection error that is hard to diagnose
from the report alone.

See [docs/requirements.md](docs/requirements.md) for the full requirements checklist,
[docs/reading-the-report.md](docs/reading-the-report.md) for how to interpret severities and
findings, and [docs/troubleshooting.md](docs/troubleshooting.md) for common launch and report
failures and their fixes (`src/mocks/defects.ts` is the catalogue of deliberate non-conformances
the test suite uses to prove each one is detected).

## Running it locally

```sh
yarn install
yarn dev
```

Open <http://localhost:3001>. In any non-production build, this app runs an in-repo mock EHR (see
`src/app/mock-ehr-enabled.ts` and `src/app/api/mocks/fhir/[[...path]]/route.ts`), so the landing
page shows a **"Try it against the built-in mock EHR"** button, launching the same code path a real
EHR would:

```
GET /launch?iss=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmocks%2Ffhir&launch=demo
```

The mock is conformant by default: a clean run produces zero `ERROR` findings (asserted by the
`baseline: the fully conformant mock` test in `src/validation/defects.integration.ts`). If your own
server produces errors the mock does not, the problem is in your server. The mock can also
simulate specific non-conformances (see `src/mocks/defects.ts` and
[docs/reading-the-report.md](docs/reading-the-report.md)).

### Tests

```sh
yarn test              # unit tests
yarn test:integration   # integration tests, including the full defect catalogue against the mock EHR
yarn e2e:install        # one-time: installs the Playwright browser
yarn e2e                # end-to-end smoke test: launch → callback → report, in a real browser
```

## For Nav developers / architecture

This app is deployed on [nais](https://doc.nais.io/) (see `.nais/nais-dev.yaml`). Session and
report storage is in-process and in-memory only (`src/core/storage/session-store.ts`,
`src/app/report/report-store.ts`): it does not survive a pod restart and is not shared across
replicas, so a launch and its callback must land on the same pod within the session's TTL. This is
an accepted tradeoff, see `replicas.min`/`replicas.max` in `.nais/nais-dev.yaml`.

### Signing key

This app signs with its own key for `private_key_jwt` client authentication and publishes the
public half at `/.well-known/jwks.json`. Generate one with `yarn generate-key`, which prints a
single JSON line. Set it as `SMART_PRIVATE_JWK` in the deployed environment's secret
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
