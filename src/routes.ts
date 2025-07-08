import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [index('routes/validation.tsx'), route('*?', 'routes/not-found.tsx')] satisfies RouteConfig
