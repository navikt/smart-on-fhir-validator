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
            thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
        },
    },
    resolve: { tsconfigPaths: true },
})
