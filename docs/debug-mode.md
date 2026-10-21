# Debug mode

Debug mode lets you send your own FHIR requests to the server from your launch and inspect the exact
request and response. Use it to reproduce a finding from the report or to try a call the report does
not make.

## Opening it

Debug mode needs a completed SMART launch in this browser. Open it from the report with
**Open Debug mode**. If there is no active session, `/debug` says so. Launch from your EHR, or use the
mock EHR on the front page, and try again.

## Warning: writes change the real EHR

Debug mode sends whatever you build to the FHIR server of your session. Any method other than GET or HEAD
may change data there, whichever token you send. Check the method, target and body before you send. Use
test environments only.

## Building a request

- **Resource type and id.** The CapabilityStatement in the sidebar guides you, but it does not limit
  what you can request. The **Resource type** list offers every type the server advertises, `metadata`, and **None (system level)**. Choose **Custom** to type any resource type the server might support.
- **Method.** GET, POST, PUT, PATCH, DELETE, HEAD, or **Other** for a custom method. CONNECT and TRACE
  are rejected.
- **Query.** Search parameters, up to 2048 characters.
- **Body.** JSON, for methods that take one. The content type is `application/fhir+json`; PATCH can
  also use `application/json-patch+json`.

- **Authorization.** Choose how the request is authenticated:
  - **Session token** (default) sends your launch access token as the `Authorization` header. The token
    always stays on the server, and it is refreshed first if it has expired.
  - **No token** sends no `Authorization` header, for example to see how the server answers an
    unauthenticated call.
  - **Custom token** sends a token you paste into the **Custom access token** field, for example
    to test an invalid or differently scoped token. See [Custom access tokens](#custom-access-tokens).

  All three modes need an active launch session. Only the session token is refreshed, so No token and
  Custom token still work after the launch token has expired.

The request always goes to the FHIR base URL of your session. Nothing outside it can be reached.

## Custom access tokens

Normally choose **Session token**, which needs no copying. Use **Custom token** only to test a token you
supply yourself.

The field is plain text, not masked, so others can read it from your screen. Paste only your own approved
test credentials, and never put credentials into external tools. The token must be a bearer token
(letters, digits and `-._~+/`, optionally ending in `=`, at most 16384 characters). It is sent to the app
in the request body and on to the FHIR server. The app holds it in this page's memory only, until you
clear the field, leave Custom token or reload the page. It is not saved in history or your session, and
the `Authorization` header is redacted in the recorded exchange. The app cannot control what the FHIR
server logs.

### Accepted formats

Paste the token value alone:

```text
your-token-here
```

Or paste the whole sign-in response. Only the `access_token` value is sent; the rest is ignored:

```json
{
  "access_token": "your-token-here",
  "token_type": "Bearer",
  "refresh_token": "your-refresh-token-here"
}
```

These examples are fake. They are not valid credentials, and a real server may also reject a token that
has expired or was issued for a different audience.

### Common mistakes

- **A decoded JWT payload**, such as `{"sub": "123", "aud": "https://example.org", "exp": 1700000000}`.
  These are the claims inside a token, not the token. The app does not sign modified token details and
  cannot create a token the server will accept.
- **The encoded JWT in pieces or edited.** If the token is a signed JWT, paste it exactly as issued.
  Changing the contents invalidates the signature. Not every access token is a JWT: opaque tokens are
  also valid, so paste whatever the sign-in response gives.
- **A `Bearer ` prefix.** Paste the value only. The app adds `Bearer` itself.
- **A refresh token or ID token.** Only the access token authorizes FHIR requests.
- **Incomplete JSON**, for example a response cut off before the closing brace. Copy the entire response
  again, or paste just the token.

## Shortcuts and predefined terms

**Launch shortcuts** fill the form from your launch context: the patient, the encounter, the signed-in
user, and searches for that patient's conditions and observations. A shortcut only appears when the
launch returned the value it needs. The condition and observation searches use `patient=` or
`subject=Patient/{id}`, whichever the CapabilityStatement lists for that resource, and `patient=` when it
lists neither or could not be loaded. Both are valid [R4 search parameters](https://hl7.org/fhir/R4/condition.html#search)
on Condition (`patient` is limited to Patient subjects, `subject` also accepts Group), but a server may implement only one.

The five **predefined terms** load a request into the form when you click them. Nothing is sent until you press Send, and you can edit the request first. Shortcuts, predefined terms and the sidebar keep the current
**Authorization** choice and any custom token you typed:

| Predefined term               | What it does                                                    |
|-------------------------------|-----------------------------------------------------------------|
| Read the launch patient       | A read by id.                                                   |
| Search conditions             | A search that returns a Bundle.                                 |
| Create a DocumentReference    | A POST. **This is a write**, and it creates a resource on the server. |
| Read the CapabilityStatement  | Reads `metadata`.                                               |
| Read a missing patient        | Fails on purpose to show an OperationOutcome.                   |

Predefined terms that need a patient are disabled when the launch did not return one.

## Launch token panel

The panel shows the granted scopes, the launch context, the expiry time, and the decoded claims of the
ID token. The raw access, refresh and ID tokens never reach the browser.

## How requests are sent

- The browser calls this app, and the server calls your FHIR server. The same goes for the
  CapabilityStatement fetch.
- The target is always the FHIR base URL of the session. The resource type, id and query are validated
  before the URL is built.
- The app only accepts a same-origin `Origin` header and a JSON content type.
- Redirects from the FHIR server are not followed.
- The session token is added to the `Authorization` header on the server. Whatever the mode, the header
  is redacted in the exchange you see.

## History

The last 20 requests are kept in browser memory so you can open them again. Reloading the page clears
them. Each entry remembers its **Authorization** choice but never a custom token: opening an entry
restores the choice and clears the token field, so enter it again.

The list shows the newest three. **Show more** reveals the older ones, up to 20, and **Show less** collapses it again.

## Limits

| Limit                | Value                                                      |
|----------------------|------------------------------------------------------------|
| Request body         | 1 MB (UTF-8)                                               |
| Response capture     | 1 MB. The content of a larger body is discarded.           |
| Query                | 2048 characters                                            |
| Upstream timeout     | 15 seconds                                                 |
