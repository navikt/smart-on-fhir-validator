export const dynamic = 'force-dynamic'

export function GET(): Response {
    return new Response('alive', { status: 200 })
}
