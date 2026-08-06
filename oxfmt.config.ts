import { defineConfig } from 'oxfmt'

export default defineConfig({
    printWidth: 110,
    semi: false,
    singleQuote: true,
    tabWidth: 4,
    // nais manifests are Handlebars templates: formatting rewrites `{{ var }}` into
    // `{ { var } }` and breaks the deploy. Markdown and workflows are hand-formatted.
    ignorePatterns: [
        '.next',
        'node_modules',
        '.nais',
        '.github',
        'coverage',
        'test-results',
        'public',
        '**/*.yml',
        '**/*.yaml',
        '**/*.md',
    ],
})
