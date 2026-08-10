import pino from 'pino'

/**
 * Server-only logger. FHIR payloads, tokens and `HttpExchange` records may carry a real
 * fødselsnummer from a vendor's test environment: log only identifiers (session id, phase,
 * issuer, status code), never a request or response body.
 */
export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    formatters: {
        level: (label) => ({ level: label }),
    },
})
