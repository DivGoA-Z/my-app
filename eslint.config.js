import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui's own generated files (src/components/ui/**) export a
    // component alongside its cva() variants function from the same
    // file by convention (button.tsx's buttonVariants, badge.tsx's
    // badgeVariants, etc) — upstream shadcn's own templates disable
    // this rule for exactly that directory, rather than splitting
    // vendored files apart in a way that would fight every future
    // `npx shadcn add`/diff against upstream.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
