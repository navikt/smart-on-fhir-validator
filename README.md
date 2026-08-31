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

Registering an EHR takes four steps, in one pull request plus one configuration change on your side:

1. **Tell this app how to authenticate with your EHR** — [Step 1](#step-1-add-your-ehr-to-the-config-file)
2. **Let Nav's cluster reach your EHR's servers** — [Step 2](#step-2-allow-network-access)
3. **Configure your EHR to launch this app** — [Step 3](#step-3-launch-from-your-ehr)
4. **Read the result** — [Step 4](#step-4-read-the-report)

Steps 1 and 2 happen in the same pull request, against one file. No SMART or OAuth background is
assumed below: if a term is unfamiliar, it's explained inline the first time it's used.

> **In a hurry and your authorization server supports Dynamic Client Registration (RFC 7591)?**
> You can skip Step 1 (the `SMART_ISSUERS` entry): this app registers itself automatically as a
> public client on first launch. You still need Step 2 (network access) — including the host of
> your `registration_endpoint`, which may differ from your other hosts — since nothing works
> without it. Then go straight to [Step 3](#step-3-launch-from-your-ehr).

### Step 1: Add your EHR to the config file

This app is an **OAuth client** — a piece of software (this one) that logs in via your EHR's
**authorization server** (the part of your EHR system that issues access tokens, separate from the
FHIR server that holds patient data). Before it will exchange tokens with this app, it needs to
know this app's identity (a `clientId`) and how this app proves that identity (no secret, a shared
secret, or a signed key — see the three options below). You give it that information by editing one
file: **[`.nais/nais-dev.yaml`](.nais/nais-dev.yaml)**.

Open that file and find the block that starts with `SMART_ISSUERS` (use your editor's search).
Today it looks like this, because no vendor is registered yet:

```yaml
- name: SMART_ISSUERS
  value: |
    []
```

You'll turn that `[]` into a JSON array with one object describing your EHR. There are three
possible shapes for that object, depending on how your authorization server expects a client to
identify itself. **Pick the one that matches your setup** — if you're not sure which one applies,
ask whoever configured your EHR's SMART/OAuth settings, or open an
["Onboard an EHR" issue](../../issues/new?template=onboard-ehr.yml) and a maintainer will help.

Every field below is a name or a public identifier, never a secret — this whole file is safe to
edit directly in the GitHub web UI, and the diff is safe to make public.

**Option A — no client secret at all ("public" client, `authType: "public"`).** Use this if your
authorization server doesn't ask for a client secret. Instead, replay protection comes from PKCE
("Proof Key for Code Exchange" — a one-time secret this app generates and verifies for each login,
so no long-lived secret is needed), which this app always uses automatically. Nothing extra to
configure here or on your EHR's side beyond selecting "public"/PKCE as the authentication method:

```json
[
  {
    "name": "Acme EHR",
    "fhirBaseUrl": "https://fhir.acme.example.com/R4",
    "clientId": "acme-validator-client",
    "authType": "public"
  }
]
```

**Option B — a shared secret ("symmetric" auth, `authType: "symmetric"`).** Use this if your
authorization server issued you (or will issue this app) a client secret string:

```json
[
  {
    "name": "Acme EHR",
    "fhirBaseUrl": "https://fhir.acme.example.com/R4",
    "clientId": "acme-validator-client",
    "authType": "symmetric",
    "clientSecretEnv": "SMART_CLIENT_SECRET_ACME"
  }
]
```

This example omits `method`, which defaults to `client_secret_basic` (the secret sent in an
`Authorization` header). If your authorization server administrator instead told you to send the
secret in the POST body, add `"method": "client_secret_post"` to the object above — ask them if
you're not sure which one applies.

`clientSecretEnv` is **a name you invent for the secret, not the secret itself** — it must start
with `SMART_CLIENT_SECRET_` (for example `SMART_CLIENT_SECRET_ACME`) and, since other vendors are
registered in the same file, it **must be unique** — pick something that includes your vendor name,
not a generic name like `SMART_CLIENT_SECRET_EHR` that another entry might already use (CI rejects
duplicates). Never paste the actual secret value into this file, a commit, or your pull request
description: once merged, it is public and permanent. After your PR is open, ask a maintainer
(comment `@navikt/helseopplysninger` on the PR) to set the real secret value in Nav's deployment
secret; see [Step 1b](#step-1b-if-you-chose-a-shared-secret) below.

**Option C — a signed key ("asymmetric" auth, `private_key_jwt`, `authType: "asymmetric"`).** Use
this if your authorization server lets you register a client's public signing key instead of a
secret. There's no secret to manage on either side: this app publishes its one public key at a
fixed URL (see [Step 3](#step-3-launch-from-your-ehr)) for your authorization server to fetch, so
`authType` is the only field you add:

```json
[
  {
    "name": "Acme EHR",
    "fhirBaseUrl": "https://fhir.acme.example.com/R4",
    "clientId": "acme-validator-client",
    "authType": "asymmetric"
  }
]
```

In all three options, replace `"Acme EHR"`, `"https://fhir.acme.example.com/R4"` and
`"acme-validator-client"` with your own vendor name, FHIR base URL (the `iss` your SMART launch
supplies), and client ID. **If the array already has other entries in it, add a comma and your
object before the closing `]` — don't delete what's already there.**

The exact fields allowed for each `authType`, and what happens if you get one wrong, are defined in
[`src/core/config/issuers.ts`](src/core/config/issuers.ts): your pull request is checked
automatically against that same schema (`src/core/config/manifest-issuers.test.ts` in CI, or run
`yarn test` yourself), so a typo or a missing field fails your PR with a clear error instead of
failing silently after deploy.

#### Step 1b: If you chose a shared secret

`clientSecretEnv` only reserves a *name* — Nav still needs to set the actual secret *value*
somewhere your entry can't reach: the `smart-on-fhir-validator-clients` Kubernetes secret, not this
file. Once your PR from Step 1 is open, comment on it (or ping `@navikt/helseopplysninger`) with the
name you chose and, through a secure/private channel of your choosing, the secret value itself. A
maintainer sets it before merging. If your authorization server supports Option A or C instead, you
can skip this step entirely — that's why they're listed first.

### Step 2: Allow network access

Nav's cluster blocks all outbound network traffic from this app ("egress") except to an explicit
allowlist. If you skip this step, your Step 1 entry will still pass CI and merge, but your EHR's
launch will fail at runtime with a network/egress error, which is confusing to debug from the
report alone. Do both steps in the same pull request.

In the same file, **[`.nais/nais-dev.yaml`](.nais/nais-dev.yaml)**, find `spec.accessPolicy.outbound.external`
(near the top of the file). Add one `- host: "..."` line for **every hostname this app needs to
call to complete your SMART launch**: your FHIR base URL's host, your authorization endpoint's
host, your token endpoint's host, and your JWKS URI's host if it differs. These are frequently *not*
all the same hostname — for example `fhir.acme.example.com` for FHIR but `auth.acme.example.com`
for authorization and tokens — so don't assume one host covers everything. If you're not sure which
hosts are involved, ask your EHR's SMART/OAuth administrator, or fetch
`<your fhirBaseUrl>/.well-known/smart-configuration` yourself: it's a JSON document listing every
endpoint URL (`authorization_endpoint`, `token_endpoint`, `jwks_uri`, etc.) and their hostnames.


```yaml
external:
  - host: "api.dips.no"
  - host: "fhirapi.public.webmedepj.no"
  # ↓ add every hostname your integration touches, one per line, for example:
  - host: "fhir.acme.example.com"
  - host: "auth.acme.example.com"
```

### What your finished pull request should look like

If you did both steps correctly for a fictional vendor "Acme EHR" using a shared secret (Option B),
your diff against `.nais/nais-dev.yaml` looks like this — two additions, in one PR:

```diff
       external:
         - host: "api.dips.no"
         - host: "fhirapi.public.webmedepj.no"
         - host: "launch.smarthealthit.org"
         - host: "epj.ekstern.dev.nav.no"
+        - host: "fhir.acme.example.com"
+        - host: "auth.acme.example.com"
```

```diff
     - name: SMART_ISSUERS
       value: |
-        []
+        [
+          {
+            "name": "Acme EHR",
+            "fhirBaseUrl": "https://fhir.acme.example.com/R4",
+            "clientId": "acme-validator-client",
+            "authType": "symmetric",
+            "clientSecretEnv": "SMART_CLIENT_SECRET_ACME"
+          }
+        ]
```

Checklist before you open it:

- [ ] Your `SMART_ISSUERS` object matches one of the three options in Step 1 exactly (right field
      names, `authType` spelled correctly, `clientSecretEnv` only if `authType` is `symmetric`).
- [ ] No secret *value* appears anywhere in the diff — only names and public identifiers.
- [ ] Every hostname your integration touches (FHIR, authorization, token, JWKS) is listed under
      `spec.accessPolicy.outbound.external`, even if some of them repeat a hostname you already see
      in the list from another vendor.
- [ ] `yarn test` passes locally, or you're relying on CI to run
      `src/core/config/manifest-issuers.test.ts` for you.
- [ ] If `authType` is `symmetric`, you've flagged the PR for a maintainer to set the secret value
      (Step 1b) — the PR alone does not configure the secret.

### Step 3: Launch from your EHR

Once your pull request is merged (and, for a shared secret, the maintainer has set the value),
configure your EHR to open this app the same way it would open any other SMART app for a clinician
— from your EHR, that means directing the browser to this app's launch URL **with two query
parameters your EHR fills in itself**:

```text
{this app's origin}/launch?iss=<your exact fhirBaseUrl>&launch=<opaque value your EHR generates>
```

- `iss` (short for "issuer" in the SMART spec, nothing to do with `authType`) must be **exactly**
  the `fhirBaseUrl` string you wrote in Step 1 — the FHIR server base URL, not the authorization or
  token endpoint.
- `launch` is an opaque identifier your EHR generates per session, telling this app which
  patient/encounter context to use; you don't choose its value, your EHR's SMART launch mechanism
  produces it automatically once the launch URL and redirect URI (below) are configured.

Beyond the URL, your EHR's own SMART/OAuth client configuration needs to match what you registered
in Step 1 exactly:

| Item                              | Value                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redirect URI                       | `{this app's origin}/callback`                                                                                                                                                                                                                                   |
| Client ID                          | Exactly the `clientId` you set in Step 1                                                                                                                                                                                                                        |
| Client authentication method       | Whatever your EHR's configuration UI calls the `authType` you set in Step 1: "none"/public client + PKCE for `public`; `client_secret_basic` or `client_secret_post` (your `method`, Option B) with the matching secret for `symmetric`; `private_key_jwt` for `asymmetric`, pointing at the JWKS URL below |
| Requested scopes                   | `openid fhirUser launch launch/patient offline_access patient/Patient.rs patient/Practitioner.rs patient/PractitionerRole.rs patient/Organization.rs patient/Encounter.rs patient/Condition.rs patient/DocumentReference.cruds patient/Binary.cruds patient/QuestionnaireResponse.cruds` |
| JWKS URL (only if `authType: "asymmetric"`) | `{this app's origin}/.well-known/jwks.json` — this app's one public signing key, which your authorization server fetches to verify its `private_key_jwt` tokens                                                                                    |

In Nav's dev environment, `{this app's origin}` is `https://nav-on-fhir.ekstern.dev.nav.no`; locally
it is `http://localhost:3001`. A vendor whose authorization server grants a narrower set of scopes
than requested is not penalised for it: the Scopes and Launch Context sections report what was
granted, not what was asked for. If launch fails immediately (before you even see a report) with an
error like `missing_launch` or `invalid_iss`, check the query parameters above first; if it fails
after you log in at your EHR, the `clientId`/auth method almost certainly doesn't match what's in
`.nais/nais-dev.yaml` — see [docs/troubleshooting.md](docs/troubleshooting.md).

### Step 4: Read the report

After a successful launch, this app redirects to `/report`, which lists every check it ran against
your FHIR server with a pass/fail/warning verdict and the exact HTTP request/response evidence
behind it.

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
(`smart-on-fhir-validator-clients`); never commit it. Without it, `src/core/smart/jwks.ts`
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
