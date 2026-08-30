import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
                },
                extends: true,
            },
            {
                test: {
                    name: 'integration',
                    include: ['src/**/*.integration.ts'],
                    testTimeout: 30_000,
                },
                extends: true,
            },
        ],
        coverage: {
            provider: 'v8',
            include: ['src/core/**', 'src/validation/**'],
            // Measured against `yarn test:coverage` (unit + integration together, the number
            // that matters, since real coverage of discovery-failure branches and
            // defect-driven validation paths comes from the integration suite, not unit tests
            // alone). Actual combined numbers at last measurement: statements 95.08%,
            // branches 89.84%, functions 97.34%, lines 95.4%. Thresholds below are set with
            // headroom under those real numbers, high enough to catch a real regression, not so
            // tight that unrelated single-line coverage noise breaks an unrelated PR.
            thresholds: { statements: 90, branches: 82, functions: 90, lines: 90 },
        },
    },
    resolve: { tsconfigPaths: true },
})
