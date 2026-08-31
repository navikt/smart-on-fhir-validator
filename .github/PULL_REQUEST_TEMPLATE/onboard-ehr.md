# Onboard EHR: <vendor name>

Checklist for a pull request that adds an entry to the `SMART_ISSUERS` array in
[`.nais/nais-dev.yaml`](../../.nais/nais-dev.yaml). See the README's
["Register your EHR"](../../blob/main/README.md#register-your-ehr) walkthrough, in particular
["What your finished pull request should look
like"](../../blob/main/README.md#what-your-finished-pull-request-should-look-like) for a worked
example of exactly this diff.

**Never paste a client secret value into this PR description, a commit message, or the diff.**
Pull requests are public and permanent. If your integration uses `symmetric` client
authentication, the only thing that belongs in `SMART_ISSUERS` is a `clientSecretEnv` *name*
(for example `SMART_CLIENT_SECRET_ACME`), never the secret value.

Prefer `public` (PKCE) or `asymmetric` (`private_key_jwt`) if your authorization server supports
either: both need zero secret coordination with Nav. `symmetric` requires a maintainer to set the
secret value afterwards (see below), which adds a round trip.

## Before opening this PR

- [ ] My entry is valid JSON and matches the schema in
      [`src/core/config/issuers.ts`](../../src/core/config/issuers.ts): `name`, `fhirBaseUrl`,
      `clientId`, `authType` (`public`, `symmetric`, or `asymmetric`), and for `symmetric` also
      `method` (`client_secret_basic` or `client_secret_post`, defaults to basic) and
      `clientSecretEnv` matching `^SMART_CLIENT_SECRET_[A-Z0-9_]+$`.
- [ ] I ran `yarn test` locally (or will let CI run it): `src/core/config/manifest-issuers.test.ts`
      parses the `SMART_ISSUERS` value straight out of the manifest through the real schema, so a
      mistake here fails this PR, not the deployed pod.
- [ ] Every hostname my integration touches, the FHIR base URL, the authorization endpoint, the
      token endpoint, and the JWKS URI if it differs, is also added to
      `spec.accessPolicy.outbound.external` in `.nais/nais-dev.yaml`, in this same PR. These can
      be on different hostnames than the FHIR base URL; all of them need to be reachable, or the
      app cannot call out to them.
- [ ] If my `authType` is `symmetric`, `clientSecretEnv` names the variable only, no secret value
      appears anywhere in this diff.

## After opening this PR

- [ ] If my `authType` is `symmetric`, I've asked a maintainer (comment on this PR, or ping
      `@navikt/helseopplysninger`) to set the actual secret value in the
      `smart-on-fhir-validator-clients` Kubernetes secret. This PR only ever references it by
      name; the value is never written here.
