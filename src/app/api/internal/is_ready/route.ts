export const dynamic = 'force-dynamic'

export function GET(): Response {
    return new Response('ready', { status: 200 })
}
