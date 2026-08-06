import pino from 'pino'

/**
 * Server-only logger for the SMART layer. FHIR payloads, tokens and full `HttpExchange` records
 * may contain a real Norwegian fødselsnummer from a vendor's test environment: only ever log
 * identifiers such as session id, phase, issuer or status code, never a request or response body.
 */
export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    formatters: {
        level: (label) => ({ level: label }),
    },
})
