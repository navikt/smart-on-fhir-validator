import ErrorPage from "./ErrorPage.tsx";
import {useSmartClient} from "../smart/SmartClient.ts";
import SmartConfigValidation from "../components/SmartConfigValidation.tsx";
import IdTokenValidation from "../components/IdTokenValidation.tsx";
import UserValidation from "../components/UserValidation.tsx";
import PatientValidation from "../components/PatientValidation.tsx";
import EncounterValidation from "../components/EncounterValidation.tsx";

function App() {
  const {client, error: smartError} = useSmartClient();

  const error = smartError;
  return <div>
    <p className="text-3xl text-center pb-5">NAV SMART on FHIR compliance test</p>
    {error ?
      <ErrorPage error={error}/> :
      <div className="flex flex-col">
        <SmartConfigValidation client={client}/>
        <br/>
        <IdTokenValidation client={client}/>
        <br/>
        <UserValidation client={client}/>
        <br/>
        <PatientValidation client={client}/>
        <br/>
        <EncounterValidation client={client}/>
      </div>
    }
  </div>;
}

export default App;
