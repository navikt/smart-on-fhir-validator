import { expect, test, type Page } from '@playwright/test'

/**
 * The one real end-to-end journey this suite protects: a user lands on the tool, launches
 * against the built-in mock EHR (no external network, no real vendor credentials — see
 * `src/app/api/mocks/fhir/[[...path]]/route.ts`), is carried through the full SMART launch by
 * this app's own server-side routes, and lands on a report they can inspect and download.
 *
 * Selectors are role/text-based throughout, not CSS, so this survives visual restyling.
 *
 * This suite is the safety gate that makes Renovate dependency automerge safe. It previously
 * reported "4 passed" while every launch actually ended at
 * `/callback/error?error=session_not_found` — three of the tests below were marked `test.fail()`,
 * so their expected failure read as a pass. `launchAgainstMockEhr` now asserts the terminal URL
 * directly, with a message naming the exact error, instead of tolerating an error page as one of
 * two "acceptable" outcomes: a gate that passes while the happy path is broken is worse than no
 * gate at all.
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

    test('launching against the mock EHR reaches a real report with a verdict and sections', async ({
        page,
    }) => {
        await launchAgainstMockEhr(page)

        // `role="status"` is set unconditionally by `VerdictBanner` for every possible verdict
        // (pass / pass-with-warnings / fail / skipped) — this assertion is intentionally verdict-
        // agnostic, since the mock EHR's exact defect-free behaviour is validated in depth by the
        // integration suite (`src/validation/defects.integration.ts`), not here.
        const verdict = page.getByRole('status')
        await expect(verdict).toBeVisible()
        await expect(verdict).toHaveText(/Pass|Fail|Incomplete/)

        await expect(page.getByText('Issuer', { exact: true })).toBeVisible()
        await expect(page.getByText('FHIR base URL', { exact: true })).toBeVisible()
        await expect(page.getByText('Client ID', { exact: true })).toBeVisible()

        // Real sections, not a placeholder page: `SectionCard` renders one <article> per
        // `ValidationReport` section (SMART launch, FHIR reads, FHIR write-back all produce one).
        const sections = page.locator('article')
        await expect(sections.first()).toBeVisible()
        expect(await sections.count()).toBeGreaterThan(1)
    })

    test('a finding can be expanded to reveal the raw request/response evidence', async ({ page }) => {
        await launchAgainstMockEhr(page)

        // `ExchangePanel` renders a native <details>/<summary> whose summary text always starts
        // with "Evidence:" (see `#components/exchange/ExchangePanel`) — every finding tied to a
        // recorded exchange has one, and the mock EHR always produces at least one such finding.
        const evidenceToggle = page.getByText('Evidence:', { exact: false }).first()
        await expect(evidenceToggle).toBeVisible()

        // Collapsed by default: the sections are present in the DOM (native <details>) but not
        // visible until expanded.
        const requestSection = page.locator('section[aria-label="Request"]').first()
        const responseSection = page.locator('section[aria-label="Response"]').first()
        await expect(requestSection).toBeHidden()
        await expect(responseSection).toBeHidden()

        await evidenceToggle.click()

        await expect(requestSection).toBeVisible()
        await expect(requestSection.getByText(/GET|POST|PUT/).first()).toBeVisible()
        await expect(responseSection).toBeVisible()
        await expect(responseSection.getByText(/HTTP \d{3}/).first()).toBeVisible()
    })

    test('the full validation report can be downloaded as JSON with real findings, never a real credential', async ({
        page,
    }) => {
        await launchAgainstMockEhr(page)

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

        // Not just well-formed JSON: a real launch's report contains real findings. A report with
        // zero findings anywhere would let this test pass even against an empty/broken run.
        const sections = (report as { sections: { findings: unknown[] }[] }).sections
        const totalFindings = sections.reduce((total, section) => total + section.findings.length, 0)
        expect(totalFindings).toBeGreaterThan(0)

        // This is a validator handling real patient data; a leaked bearer token, refresh token or
        // client secret is the single worst failure mode. Walks the entire downloaded artefact —
        // the literal bytes a vendor would attach to a support ticket.
        assertCredentialsRedacted(report, 'report')
    })

    test('no access token, refresh token or client secret ever appears in the rendered report HTML', async ({
        page,
    }) => {
        await launchAgainstMockEhr(page)

        // Expand every collapsed <details> first: this data must never reach the browser at all,
        // collapsed or not, so the check must not be able to pass merely because content happened
        // to still be collapsed. Clicking each <summary> (rather than reaching into the DOM)
        // exercises the same toggle a real user would, and needs no browser-context typing.
        const summaries = page.locator('details > summary')
        const summaryCount = await summaries.count()
        for (let index = 0; index < summaryCount; index += 1) {
            await summaries.nth(index).click()
        }

        const bodyText = await page.locator('body').innerText()

        // `JsonBlock` pretty-prints exchange bodies (see `#components/json/JsonBlock`), so a real
        // leak would render as ordinary `"key": "value"` text — these patterns catch it directly.
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
    })
})
