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
  - **Custom token** sends a token you type into the masked **Custom access token** field, for example
    to test an invalid or differently scoped token. It must be a bearer token (letters, digits and
    `-._~+/`, optionally ending in `=`, at most 16384 characters). It is sent to the app in the request body
    and on to the FHIR server. The app holds it in this page's memory only, until you clear the field,
    leave Custom token or reload the page. It is not saved in history or your session, and the
    `Authorization` header is redacted in the recorded exchange. Page memory is lost on reload, unlike
    persistent storage such as cookies or local storage. The app cannot control what the FHIR server logs.

  All three modes need an active launch session. Only the session token is refreshed, so No token and
  Custom token still work after the launch token has expired.

The request always goes to the FHIR base URL of your session. Nothing outside it can be reached.

## Shortcuts and predefined terms

**Launch shortcuts** fill the form from your launch context: the patient, the encounter, the signed-in
user, and searches for that patient's conditions and observations. A shortcut only appears when the
launch returned the value it needs.

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

## Limits

| Limit                | Value                                                      |
|----------------------|------------------------------------------------------------|
| Request body         | 1 MB (UTF-8)                                               |
| Response capture     | 1 MB. The content of a larger body is discarded.           |
| Query                | 2048 characters                                            |
| Upstream timeout     | 15 seconds                                                 |
