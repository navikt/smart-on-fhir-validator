import { defineConfig } from 'oxfmt'

export default defineConfig({
    printWidth: 110,
    semi: false,
    singleQuote: true,
    tabWidth: 4,
    ignorePatterns: ['.next', 'node_modules'],
})
