import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT ?? '3100'
const BASE_URL = `http://localhost:${PORT}`

/**
 * The mock EHR is only reachable when `isMockEhrEnabled()` is true, so `ENABLE_MOCK_EHR` is set
 * on both paths rather than relying on `NODE_ENV` alone.
 *
 * Trap: do NOT "simplify" the CI command to `next start`. With `output: 'standalone'` it serves a
 * broken app without failing loudly. CI must run `node server.js` out of `.next/standalone`, with
 * `.next/static` and `public` copied alongside, exactly like the `Dockerfile` does.
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
    // Single worker: the mock EHR module keeps a per-process singleton, so parallel runs would
    // share launch state.
    workers: 1,
    forbidOnly: !!process.env.CI,
    // Flake should be fixed, not retried.
    retries: 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
    // >5x headroom over the ~2.5s `/report` render measured after dropping
    // react-syntax-highlighter. Do not raise it: a regression back to multi-second renders must
    // fail loudly rather than hide behind a generous ceiling.
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
        // A cold CI runner can spend a couple of minutes on `next build`; a generous ceiling
        // avoids flaky "server never came up" failures.
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
        // `NODE_ENV=production` only for the CI/standalone path: `next dev` requires it unset.
        env: {
            ENABLE_MOCK_EHR: 'true',
            PORT,
            ...(process.env.CI ? { NODE_ENV: 'production' } : {}),
        },
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
