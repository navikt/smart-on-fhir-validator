import ErrorPage from '../components/layout/ErrorPage'
import Header from '../components/layout/Header'
import Page from '../components/layout/Page'
import RefetchSidebar from '../components/main-validation/RefetchSidebar'
import Spinner from '../components/spinner/Spinner'
import ValidationSection from '../components/validation-table/ValidationSection'
import ConditionValidation from '../components/validators/ConditionValidation'
import DocumentReferenceValidation from '../components/validators/DocumentReferenceValidation'
import EncounterValidation from '../components/validators/EncounterValidation'
import IdTokenValidation from '../components/validators/IdTokenValidation'
import PatientValidation from '../components/validators/PatientValidation'
import PractitionerValidation from '../components/validators/PractitionerValidation'
import SmartConfigValidation from '../components/validators/SmartConfigValidation'
import B64WritableDocumentReference from '../components/validators/document-reference/B64WritableDocumentReference'
import BinaryUploadWritableDocumentReference from '../components/validators/document-reference/BinaryUploadWritableDocumentReference'
import { useSmart } from '../smart/use-smart'

function Validation() {
  const smart = useSmart()

  return (
    <Page sidebar={<RefetchSidebar />}>
      <Header />
      {smart.error && <ErrorPage error={smart.error.message} />}
      {!smart.error && (
        <>
          <div>
            <h2 className="ml-8 font-bold text-2xl">General FHIR Resource Validation</h2>
            {smart.isLoading && <Spinner text="Initializing FHIR for resource validation" />}
            {smart.client && (
              <div className="flex flex-col gap-3">
                <ValidationSection index="1" title="SMART configuration validation">
                  <SmartConfigValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection index="2" title="ID token validation">
                  <IdTokenValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection
                  index="3"
                  title="Patient validation"
                  refs={{
                    hl7: 'https://simplifier.net/HL7Norwayno-basis/NoBasisPatient/',
                    nav: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/pasient.md',
                  }}
                >
                  <PatientValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection index="4" title="Practitioner validation">
                  <PractitionerValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection index="5" title="Encounter validation">
                  <EncounterValidation client={smart.client} />
                </ValidationSection>
              </div>
            )}
          </div>
          <div className="mt-8">
            <h2 className="ml-8 font-bold text-2xl">{`"Ny sykmelding" Resource Validation`}</h2>
            {smart.isLoading && <Spinner text="Initializing FHIR for resource validation" />}
            {smart.client && (
              <div className="flex flex-col gap-3">
                <ValidationSection index="6" title="Condition validation">
                  <ConditionValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection
                  index="7"
                  title="DocumentReference validation"
                  description={`Tries to get a list of document references based on the token "urn:oid:2.16.578.1.12.4.1.1.9602|J01-2", then validates the first element in the list.`}
                >
                  <DocumentReferenceValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection
                  index="8"
                  title="Writable (binary) DocumentReference validation"
                  description="Uploads a Binary then creates a DocumentReference to said Binary, shows the result of the mutations"
                >
                  <BinaryUploadWritableDocumentReference client={smart.client} />
                </ValidationSection>
                <ValidationSection
                  index="9"
                  title="Writable (b64) DocumentReference validation"
                  description="Uploads a DocumentReference directly with a b64 encoded payload, then shows the result of the mutation."
                >
                  <B64WritableDocumentReference client={smart.client} />
                </ValidationSection>
              </div>
            )}
          </div>
        </>
      )}
    </Page>
  )
}

export default Validation
