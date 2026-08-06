import { expect, test, type Page } from '@playwright/test'

/**
 * A thin browser smoke gate, not a test suite: everything that does not need a real browser,
 * real cookie round-trip and real rendered HTML already lives in the integration suite
 * (`*.integration.ts`, ~2s for 71 tests) and must not be duplicated here. Playwright is the
 * slowest thing in the pipeline, so this file stays to a landing-page check plus exactly one
 * consolidated happy-path journey — one launch, reused across every assertion — rather than
 * re-running the full SMART launch once per thing being checked.
 *
 * This suite is the safety gate that makes Renovate dependency automerge safe. It previously
 * reported "4 passed" while every launch actually ended at
 * `/callback/error?error=session_not_found` — most of its tests were marked `test.fail()`, so
 * their expected failure read as a pass. `launchAgainstMockEhr` now asserts the terminal URL
 * directly, with a message naming the exact error, instead of tolerating an error page as an
 * acceptable outcome: a gate that passes while the happy path is broken is worse than no gate.
 */

const TERMINAL_URL_PATTERN = /\/(report|launch\/error|callback\/error)(\?|$)/

/**
 * Navigates through the mock-EHR launch link and waits for the flow to reach a terminal page.
 * Fails loudly — naming the exact upstream `error`/`detail` — if that page is either error page
 * instead of `/report`. This is precisely the guard that let a broken happy path slip through
 * before: `test.fail()` treated `/callback/error` as an acceptable outcome.
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
 * Keys `src/core/http/redact.ts` strips from a recorded `HttpExchange` at recording time. Kept
 * here rather than imported: this suite drives the app only over HTTP, exactly as a real browser
 * would, and never reaches into its source tree.
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

/** Exchange request bodies are recorded as raw strings (JSON or form-encoded), not nested
 * objects, so a value worth checking may itself be a string that decodes to more structure. */
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
 * Recursively verifies that every sensitive key anywhere in a serialised `ValidationReport` —
 * including inside recorded exchange bodies, which are strings, not objects — is either absent
 * or exactly the `[REDACTED]` marker. Mirrors the property `report-security.integration.ts`
 * proves for the run engine directly, re-checked here against the literal bytes a browser
 * downloads.
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

        await expect(page.getByRole('heading', { name: 'What this tool does' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Launch the mock EHR' })).toBeVisible()
    })

    test('a single launch reaches a real report, its evidence expands, it downloads as JSON, and no credential ever leaks', async ({
        page,
    }) => {
        await launchAgainstMockEhr(page)

        // A real verdict and real sections — not a placeholder page. `role="status"` is set
        // unconditionally by `VerdictBanner` for every possible verdict (this assertion is
        // deliberately verdict-agnostic: the mock EHR's exact defect-free behaviour is validated
        // in depth by the integration suite, not here). `SectionCard` renders one <article> per
        // report section (SMART launch, FHIR reads, FHIR write-back all produce one).
        const verdict = page.getByRole('status')
        await expect(verdict).toBeVisible()
        await expect(verdict).toHaveText(/Pass|Fail|Incomplete/)
        await expect(page.getByText('Issuer', { exact: true })).toBeVisible()
        await expect(page.getByText('FHIR base URL', { exact: true })).toBeVisible()
        const sections = page.locator('article')
        await expect(sections.first()).toBeVisible()
        expect(await sections.count()).toBeGreaterThan(1)

        // Evidence expands: `ExchangePanel` renders a native <details>/<summary> per finding,
        // collapsed by default (present in the DOM, hidden until expanded). Expand every one —
        // this also puts every request/response body's text into the DOM for the leak check
        // below, rather than letting that check pass merely because content was still collapsed.
        const requestSection = page.locator('section[aria-label="Request"]').first()
        const responseSection = page.locator('section[aria-label="Response"]').first()
        await expect(requestSection).toBeHidden()
        await expect(responseSection).toBeHidden()

        const summaries = page.locator('details > summary')
        const summaryCount = await summaries.count()
        expect(summaryCount).toBeGreaterThan(0)
        for (let index = 0; index < summaryCount; index += 1) {
            await summaries.nth(index).click()
        }

        await expect(requestSection).toBeVisible()
        await expect(requestSection.getByText(/GET|POST|PUT/).first()).toBeVisible()
        await expect(responseSection).toBeVisible()
        await expect(responseSection.getByText(/HTTP \d{3}/).first()).toBeVisible()

        // This is a validator handling real patient data; a leaked bearer token, refresh token or
        // client secret is the single worst failure mode. Checked against the fully-expanded,
        // rendered page text — `JsonBlock` (`#components/json/JsonBlock`) pretty-prints exchange
        // bodies, so a real leak would render as ordinary `"key": "value"` text.
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
        // The literal Authorization header value used for every FHIR call in this run: redacted
        // headers render as exactly `[REDACTED]`, never the `Bearer <token>` they replaced.
        expect(bodyText).not.toMatch(/Bearer\s+(?!\[REDACTED\])[A-Za-z0-9\-_.]+/)
        expect(bodyText).not.toContain('PRIVATE KEY')

        // The JSON download: same session, no second launch. Must be well-formed, contain real
        // findings (not an empty/broken report), and — walked recursively, since exchange bodies
        // are raw strings, not just structured JSON — never a real credential either.
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
            issuer: expect.any(String),
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
