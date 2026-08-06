import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT ?? '3100'
const BASE_URL = `http://localhost:${PORT}`

/**
 * The built-in mock EHR (`#mocks/server`, mounted at `/api/mocks/fhir` — see
 * `src/app/api/mocks/fhir/[[...path]]/route.ts`) is only reachable when `isMockEhrEnabled()`
 * returns true. That is always true outside `NODE_ENV=production`, so `next dev` needs no extra
 * flag; the CI job runs a production build, where it must be set explicitly. Both paths set it so
 * this config does not silently depend on which one runs.
 *
 * CI does not run `next start`: `next.config.ts` sets `output: 'standalone'`, which `next start`
 * explicitly refuses to serve ("next start does not work with output: standalone configuration").
 * Running it anyway does not error loudly — it silently serves a broken app, which is exactly
 * how the real production deployment (`Dockerfile`) does NOT run this app, so it proved nothing.
 * `Dockerfile` runs `node server.js` out of `.next/standalone`, with `.next/static` and `public`
 * copied alongside it; this mirrors that exactly, so CI proves the thing that is actually shipped.
 */
const webServerCommand = process.env.CI
    ? 'rm -rf .next/standalone/.next/static .next/standalone/public && ' +
      'cp -r .next/static .next/standalone/.next/static && ' +
      'cp -r public .next/standalone/public && ' +
      'node .next/standalone/server.js'
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
    // Flake should be fixed, not retried — this suite is a thin smoke gate over a real browser,
    // not a place to paper over timing bugs with a second attempt.
    retries: 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
    // The /report render that motivated a generous ceiling here is gone: dropping
    // react-syntax-highlighter (it was generating ~59k styled elements, serialised twice into the
    // RSC payload) took it from ~17s to ~2.5s measured in `next dev`, and well under a second in a
    // real production build. 15s leaves >5x headroom over that without reviving the risk this
    // config used to carry — a real regression back toward multi-second renders should fail loudly
    // again, not hide behind a ceiling sized for a bug that no longer exists.
    timeout: 15_000,
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
        // `NODE_ENV=production` only for the CI/standalone path: `next dev` requires it unset,
        // and `Dockerfile` sets it explicitly for the real deployment this path now mirrors.
        env: {
            ENABLE_MOCK_EHR: 'true',
            PORT,
            ...(process.env.CI ? { NODE_ENV: 'production' } : {}),
        },
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
