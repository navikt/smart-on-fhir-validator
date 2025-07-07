import ErrorPage from '../components/layout/ErrorPage'
import Header from '../components/layout/Header'
import Page from '../components/layout/Page'
import RefetchSidebar from '../components/main-validation/RefetchSidebar'
import Spinner from '../components/spinner/Spinner'
import ValidationSection from '../components/validation-table/ValidationSection'
import ConditionValidation from '../components/validators/condition/ConditionValidation'
import DocumentReferenceValidation from '../components/validators/document-reference/DocumentReferenceValidation'
import EncounterValidation from '../components/validators/encounter/EncounterValidation'
import OrganizationValidation from '../components/validators/organization/OrganizationValidation'
import PatientValidation from '../components/validators/patient/PatientValidation'
import PractitionerValidation from '../components/validators/practitioner/PractitionerValidation'
import { useSmart } from '../smart/use-smart'
import { fullRefs } from '../validation/common-refs'

function Validation() {
  const smart = useSmart()

  return (
    <Page sidebar={<RefetchSidebar />}>
      <Header />
      {import.meta.env.DEV && smart.failureCount > 0 && (
        <div className="p-4 ml-8">
          <a href="/launch?iss=http://localhost:5000&launch=mock-launch-id" className="underline">
            Dev Mode: Launch local mock (port: 5000)?
          </a>
        </div>
      )}
      {smart.error && <ErrorPage error={smart.error.message} />}
      {!smart.error && (
        <>
          <div>
            <h2 className="ml-8 font-bold text-2xl">General FHIR Resource Validation</h2>
            {smart.isLoading && <Spinner text="Initializing FHIR for resource validation" />}
            {smart.client && (
              <div className="flex flex-col gap-3">
                <ValidationSection index="4" title="Patient validation" refs={fullRefs.pasient}>
                  <PatientValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection index="5" title="Practitioner validation" refs={fullRefs.practitioner}>
                  <PractitionerValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection index="6" title="Encounter validation" refs={fullRefs.encounter}>
                  <EncounterValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection index="7" title="Organization validation" refs={fullRefs.organization}>
                  <OrganizationValidation client={smart.client} />
                </ValidationSection>
              </div>
            )}
          </div>
          <div className="mt-8">
            <h2 className="ml-8 font-bold text-2xl">{`"Ny sykmelding" Resource Validation`}</h2>
            {smart.isLoading && <Spinner text="Initializing FHIR for resource validation" />}
            {smart.client && (
              <div className="flex flex-col gap-3">
                <ValidationSection
                  index="8"
                  title="Condition validation"
                  refs={fullRefs.condition}
                  description="These are the pasients conditions given the current Encounter. These are fetched using the Condition?encounter=<encounterId> query."
                >
                  <ConditionValidation client={smart.client} />
                </ValidationSection>
                <ValidationSection
                  index="9"
                  title="DocumentReference validation"
                  description={`Tries to get a list of document references based on the token "urn:oid:2.16.578.1.12.4.1.1.9602|J01-2", then validates the first element in the list.`}
                  refs={fullRefs.documentReference}
                >
                  <DocumentReferenceValidation client={smart.client} />
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
