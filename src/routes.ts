import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/validation.tsx'),
  route('/launch', 'routes/launch/launch.tsx'),
  route('/fhir-tester', 'routes/fhir-tester.tsx'),
  route('/fhir-creator', 'routes/fhir-create-tester.tsx'),
  route('*?', 'routes/not-found.tsx'),
] satisfies RouteConfig
