import { defineConfig } from 'oxlint'

export default defineConfig({
    plugins: ['typescript', 'react', 'nextjs', 'unicorn', 'import', 'vitest', 'promise'],
    categories: { correctness: 'error', suspicious: 'error', pedantic: 'off' },
    env: { browser: true, node: true, es2024: true },
    rules: {
        'typescript/no-explicit-any': 'error',
        'typescript/no-non-null-assertion': 'error',
        'no-console': 'error',
        'promise/no-return-wrap': 'error',
        // React 19 automatic JSX runtime: React need not be in scope.
        'react/react-in-jsx-scope': 'off',
        'import/no-unassigned-import': 'off',
    },
    ignorePatterns: ['.next', 'node_modules', 'e2e/test-results', 'playwright-report'],
    overrides: [
        {
            files: ['**/*.{test,integration}.{ts,tsx}', 'src/mocks/**', 'e2e/**'],
            rules: {
                'typescript/no-non-null-assertion': 'off',
                'no-console': 'off',
            },
        },
    ],
})
