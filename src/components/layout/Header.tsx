import { Link, useLocation } from 'react-router'

const Header = () => {
  const location = useLocation()

  return (
    <div className="ml-8 mb-4 pb-5">
      <h1 className="text-4xl ">Nav SMART on FHIR validation</h1>
      <p className="text-sm">
        Collection of resource fetches and writes to verify if a FHIR server is compliant with the FHIR specification
      </p>
      {location.pathname !== '/' && (
        <Link to="/" className="text-blue-900 hover:text-blue-700">
          <span>← </span>
          <span className="underline">Back to validations</span>
        </Link>
      )}
    </div>
  )
}

export default Header
