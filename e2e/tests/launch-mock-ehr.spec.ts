import { expect, test, type Page } from '@playwright/test'

/**
 * A thin browser smoke gate: one landing-page check plus a single consolidated SMART launch
 * journey, reused across every assertion. Anything not needing a real browser belongs in the
 * integration suite (`*.integration.ts`).
 *
 * This suite is the safety gate that makes Renovate dependency automerge safe, so it must fail
 * loudly rather than tolerate an error page: `launchAgainstMockEhr` asserts the terminal URL
 * directly.
 */

const TERMINAL_URL_PATTERN = /\/(report|launch\/error|callback\/error)(\?|$)/

/**
 * Navigates through the mock-EHR launch link and waits for the flow to reach a terminal page.
 * Fails loudly, naming the exact upstream `error`/`detail`, if that page is either error page
 * instead of `/report`.
 */
async function launchAgainstMockEhr(page: Page): Promise<void> {
    await page.goto('/')
    await page.getByRole('link', { name: 'Launch the mock EHR' }).click()
    await page.waitForURL(TERMINAL_URL_PATTERN, { timeout: 15_000 })

    const url = new URL(page.url())
    const diagnostic = `error=${url.searchParams.get('error')}, detail=${url.searchParams.get('detail')}`

    expect(url.pathname, `launch must not land on /launch/error (${diagnostic})`).not.toBe('/launch/error')
    expect(url.pathname, `launch must not land on /callback/error (${diagnostic})`).not.toBe(
        '/callback/error',
    )
    expect(url.pathname, `launch must land on /report (${diagnostic})`).toBe('/report')
}

/**
 * Keys `src/core/http/redact.ts` strips from a recorded `HttpExchange`. Duplicated rather than
 * imported: this suite drives the app only over HTTP, as a real browser would.
 */
const SENSITIVE_KEYS = new Set([
    'access_token',
    'refresh_token',
    'client_secret',
    'client_assertion',
    'code',
    'code_verifier',
    'private_key',
    'registration_access_token',
])

/** Exchange request bodies are recorded as raw strings (JSON or form-encoded), so a value worth
 * checking may itself decode to more structure. */
function decodeNested(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        // Not JSON. A form-encoded body (e.g. the token request) looks like `key=value&...`.
    }

    if (/^[\w.~-]+=/.test(value)) {
        try {
            return Object.fromEntries(new URLSearchParams(value))
        } catch {
            return undefined
        }
    }

    return undefined
}

/**
 * Recursively verifies that every sensitive key anywhere in a serialised `ValidationReport`
 * (including inside recorded exchange bodies, which are strings, not objects) is either absent
 * or exactly the `[REDACTED]` marker.
 */
function assertCredentialsRedacted(value: unknown, path: string): void {
    if (typeof value === 'string') {
        const decoded = decodeNested(value)
        if (decoded !== undefined) assertCredentialsRedacted(decoded, path)
        return
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => assertCredentialsRedacted(item, `${path}[${index}]`))
        return
    }

    if (value !== null && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(key)) {
                expect(inner, `${path}.${key} must be redacted, not a real credential`).toBe('[REDACTED]')
            } else {
                assertCredentialsRedacted(inner, `${path}.${key}`)
            }
        }
    }
}

test.describe('landing → launch against the mock EHR → report', () => {
    test('the landing page explains the tool and offers a mock-EHR launch', async ({ page }) => {
        await page.goto('/')

        await expect(
            page.getByRole('heading', { name: 'Check your SMART on FHIR implementation' }),
        ).toBeVisible()
        await expect(page.getByRole('link', { name: 'Launch the mock EHR' })).toBeVisible()
    })

    test('a single launch reaches a real report, its evidence expands, it downloads as JSON, and no credential ever leaks', async ({
        page,
    }) => {
        await launchAgainstMockEhr(page)

        // A real verdict and real sections, not a placeholder page. Deliberately
        // verdict-agnostic: the mock EHR's exact defect-free behaviour is validated in depth by
        // the integration suite.
        const verdict = page.getByRole('status')
        await expect(verdict).toBeVisible()
        await expect(verdict).toHaveText(/Pass|Fail|Incomplete/)
        await expect(page.getByText('Issuer', { exact: true })).toBeVisible()
        await expect(page.getByText('FHIR base URL', { exact: true })).toBeVisible()
        const sections = page.locator('article')
        await expect(sections.first()).toBeVisible()
        expect(await sections.count()).toBeGreaterThan(1)

        // Evidence panels are collapsed by default. Expanding one is enough to prove the
        // affordance is real; the exhaustive credential-leak check runs against the JSON
        // download below. Findings in a non-failed section sit behind that section's own
        // disclosure, so open those first to make every evidence panel reachable.
        for (const sectionDisclosure of await page.locator('article > div > details').all()) {
            await sectionDisclosure.locator('> summary').click()
        }

        const firstEvidence = page
            .locator('details:has(> summary:has-text("Evidence, HTTP request and response"))')
            .first()
        const requestSection = firstEvidence.locator('section[aria-label="Request"]')
        const responseSection = firstEvidence.locator('section[aria-label="Response"]')
        await expect(requestSection).toBeHidden()
        await expect(responseSection).toBeHidden()

        const evidenceSummaries = page.getByText('Evidence, HTTP request and response')
        expect(await evidenceSummaries.count()).toBeGreaterThan(0)
        await firstEvidence.locator('> summary').click()

        await expect(requestSection).toBeVisible()
        await expect(requestSection.getByText(/GET|POST|PUT/).first()).toBeVisible()
        await expect(responseSection).toBeVisible()
        await expect(responseSection.getByText(/HTTP \d{3}/).first()).toBeVisible()

        // This is a validator handling real patient data; a leaked bearer token, refresh token or
        // client secret is the single worst failure mode. Sampled against the rendered page here;
        // proved exhaustively against the JSON download below.
        const bodyText = await page.locator('body').innerText()
        expect(bodyText).not.toMatch(/"access_token"\s*:\s*"(?!\[REDACTED\])[^"]+"/)
        expect(bodyText).not.toMatch(/"refresh_token"\s*:\s*"(?!\[REDACTED\])[^"]+"/)
        expect(bodyText).not.toMatch(/"client_secret"\s*:\s*"(?!\[REDACTED\])[^"]+"/)
        expect(bodyText).not.toMatch(/"client_assertion"\s*:\s*"(?!\[REDACTED\])[^"]+"/)
        // Form-encoded token-request bodies are rendered raw, so a leak there is percent-encoded.
        expect(bodyText).not.toMatch(/access_token=(?!%5BREDACTED%5D)[^&\s]+/)
        expect(bodyText).not.toMatch(/refresh_token=(?!%5BREDACTED%5D)[^&\s]+/)
        expect(bodyText).not.toMatch(/client_secret=(?!%5BREDACTED%5D)[^&\s]+/)
        expect(bodyText).not.toMatch(/client_assertion=(?!%5BREDACTED%5D)[^&\s]+/)
        // Redacted headers render as exactly `[REDACTED]`, never the token they replaced.
        expect(bodyText).not.toMatch(/Bearer\s+(?!\[REDACTED\])[A-Za-z0-9\-_.]+/)
        expect(bodyText).not.toContain('PRIVATE KEY')

        // The JSON download: same session, no second launch. Walked recursively, since exchange
        // bodies are raw strings rather than structured JSON.
        const downloadPromise = page.waitForEvent('download')
        await page.getByRole('link', { name: 'Download full report as JSON' }).click()
        const download = await downloadPromise

        expect(download.suggestedFilename()).toMatch(/^smart-validator-report-\d{4}-\d{2}-\d{2}\.json$/)

        const stream = await download.createReadStream()
        expect(stream).not.toBeNull()

        const chunks: Buffer[] = []
        await new Promise<void>((resolve, reject) => {
            stream?.on('data', (chunk) => chunks.push(chunk as Buffer))
            stream?.on('end', () => resolve())
            stream?.on('error', reject)
        })

        const report: unknown = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
        expect(report).toMatchObject({
            fhirBaseUrl: expect.any(String),
            sections: expect.any(Array),
            summary: expect.any(Object),
        })

        const reportSections = (report as { sections: { findings: unknown[] }[] }).sections
        const totalFindings = reportSections.reduce((total, section) => total + section.findings.length, 0)
        expect(totalFindings).toBeGreaterThan(0)

        assertCredentialsRedacted(report, 'report')
    })
})
