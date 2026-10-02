export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('#core/config/issuers')
    }
}
