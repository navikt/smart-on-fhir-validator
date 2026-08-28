# Reading the report

## Severities

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

## Example finding

Every finding cites the spec paragraph it checks (HL7, the Norwegian `no-basis` profiles on
Simplifier, and/or Nav's own docs) and can be expanded to show the raw HTTP request and response
that produced it. The mock EHR (see the main [README](../README.md#running-it-locally)) is
conformant by default, but can simulate a specific non-conformance (see `src/mocks/defects.ts`):

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
