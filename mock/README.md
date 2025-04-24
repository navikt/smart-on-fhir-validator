# fhir-mock-server

This mock server relies on a @navikt dependency which is only available in Github Package Registry. Anyone can access the package, but you need to authenticate to install it. The authentication is done my providing a PAT under the environment variable `$NPM_AUTH_TOKEN` that has the scope `package:read`.
