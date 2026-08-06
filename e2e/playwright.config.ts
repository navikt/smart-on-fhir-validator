import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT ?? '3100'
const BASE_URL = `http://localhost:${PORT}`

/**
 * The built-in mock EHR (`#mocks/server`, mounted at `/api/mocks/fhir` — see
 * `src/app/api/mocks/fhir/[[...path]]/route.ts`) is only reachable when `isMockEhrEnabled()`
 * returns true. That is always true outside `NODE_ENV=production`, so `next dev` needs no extra
 * flag; the CI job runs a production build (`next build && next start`), where it must be set
 * explicitly. Both paths set it so this config does not silently depend on which one runs.
 */
const webServerCommand = process.env.CI
    ? `next start --port ${PORT}`
    : `next dev --port ${PORT}`

export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    // Deterministic ordering and a single worker: the mock EHR module keeps a per-process
    // singleton (see `getMockEhr` in the route above), and this is the first pass at this
    // infrastructure — favouring "slow but never flaky" over parallel speed until it has proven
    // itself. Re-visit once there is a real track record of green runs.
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
    timeout: 30_000,
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        contextOptions: { reducedMotion: 'reduce' },
    },
    webServer: {
        command: webServerCommand,
        cwd: '..',
        url: `${BASE_URL}/api/internal/is_ready`,
        // A production build (`next build`) can legitimately take a couple of minutes on a cold
        // CI runner; dev mode is normally much faster but keeps the same generous ceiling so a
        // slow CI runner does not produce a flaky "server never came up" failure.
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ENABLE_MOCK_EHR: 'true', PORT },
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
