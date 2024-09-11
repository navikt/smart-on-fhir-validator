import Client from "fhirclient/lib/Client";
import {Severity, Validation} from "../utils/Validation.ts";
import {useEffect, useState} from "react";
import {authOptions} from "../fhir/FhirAuth.ts";
import ValidationTable from "./ValidationTable.tsx";

export interface IdTokenValidationProps {
  readonly client: Client | undefined;
}

/**
 * Validates that data received in the id_token as requested by the `openid`, `profile` and `fhirUser` scopes is
 * present and formulated correctly.
 *
 * @param client - The SMART on FHIR client instance
 */
export default function IdTokenValidation({client}: IdTokenValidationProps) {
  const [validations, setValidations] = useState<Validation[]>();

  useEffect(() => {
    if (!client) return;

    const scopes: string = authOptions.scope as string;
    const clientId: string = authOptions.clientId as string;
    const idToken = client.getIdToken();

    const allowedResourceTypes = {
      Practitioner: "Practitioner",
      Patient: "Patient",
      RelatedPerson: "RelatedPerson"
    };

    console.debug("ℹ️ Requested OIDC scope(s):", scopes);
    console.debug("ℹ️ ID Token as requested via openid scope:", JSON.stringify(idToken));

    const newValidations: Validation[] = [];

    if (idToken) {
      const fhirServerUrl: string = client.getState("serverUrl");
      const fhirUser = idToken["fhirUser"] as string;
      const profile = idToken.profile;
      const issuer = idToken.iss;
      const audience = idToken.aud;

      /**
       * fhirUser claim, if present, is expected to follow the format
       * {resourceType}/{resourceId}. However, in some cases the claim
       * can contain the full URL to the resource, for example:
       *
       * https://fhir.example.com/Practitioner/{practitioner-id}
       *
       * The client library handles this, therefore the url part is
       * ignored. Expected format is therefore
       * {Practitioner | Patient | RelatedPerson}/{resource-id}
       */
      if (!fhirUser) {
        newValidations.push(new Validation(`ID token is missing the "fhirUser" claim`, Severity.ERROR));
      } else {
        const split = fhirUser.split("/").slice(-2); // Take the last two segments (resourceType/resourceId)

        if (split.length !== 2) {
          newValidations.push(new Validation(`"fhirUser" claim is not properly formatted, expected {ResourceType}/{ResourceID} but was ${fhirUser}`, Severity.ERROR));
        } else {
          const [resourceType, resourceId] = split;

          // Check if the resourceType is valid
          if (![allowedResourceTypes.Practitioner, allowedResourceTypes.Patient, allowedResourceTypes.RelatedPerson].includes(resourceType)) {
            newValidations.push(new Validation(`"fhirUser" claim MUST contain the resource type Practitioner, Patient, or RelatedPerson, but was ${resourceType}`, Severity.ERROR));
          }

          // Validate resource ID is present
          if (resourceId) {
            newValidations.push(new Validation(`"fhirUser" resource ID must be present`, Severity.ERROR));
          }
        }
      }


      /**
       * profile claim, if present, can be represented in the same way
       * as the fhirUser claim, or as just the ID of the resource.
       */
      if (!profile) {
        newValidations.push(new Validation(`ID token is missing the "profile" claim`, Severity.ERROR));
      } else {
        const split = profile.split("/").slice(-2); // Take the last two segments of the URL or just the ID

        // Determine the resourceId and resourceType based on how the profile is formatted
        const resourceId = split.length === 2 ? split[1] : split[0];
        const resourceType = split.length === 2 ? split[0] : null;

        if (resourceType && ![allowedResourceTypes.Practitioner, allowedResourceTypes.Patient, allowedResourceTypes.RelatedPerson].includes(resourceType)) {
          newValidations.push(new Validation(`"profile" claim MUST contain the resource type Practitioner, Patient, or RelatedPerson, but was ${resourceType}`, Severity.ERROR));
        }

        if (resourceId) {
          newValidations.push(new Validation(`"profile" resource ID must be present`, Severity.ERROR));
        }
      }

      if (issuer) {
        if (issuer !== fhirServerUrl) {
          newValidations.push(new Validation(`ID token issuer should be the same as the FHIR server URL (${fhirServerUrl}), but was ${idToken.iss}`, Severity.WARNING));
        }
      } else {
        newValidations.push(new Validation(`ID token is missing the "issuer" claim`, Severity.ERROR));
      }

      if (audience) {
        if (audience !== clientId) {
          newValidations.push(new Validation(`ID token audience incorrect, it should be ${clientId}, but was ${idToken.aud}`, Severity.ERROR));
        }
      } else {
        newValidations.push(new Validation(`ID token is missing the "aud" claim`, Severity.ERROR));
      }
    } else {
      newValidations.push(new Validation(`Missing ID token which was requested by the openid scope.`, Severity.ERROR));
    }

    setValidations(newValidations);
  }, [client]);

  return (
    <div className="basis-1/5">
      <ValidationTable validationTitle={"ID token validation"}
                       validations={validations}/>
    </div>
  );
}