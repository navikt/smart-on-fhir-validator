export const dynamic = 'force-dynamic'

/**
 * Called by nais before the pod is terminated. Returning 200 marks the instance as
 * draining so it is removed from the load balancer before SIGTERM arrives.
 */
export function GET(): Response {
    return new Response('stopping', { status: 200 })
}
