import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'
import prettier from 'eslint-config-prettier'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// eslint-config-next@15 is still eslintrc-format, so FlatCompat is required.
// (Native flat config only arrives in eslint-config-next@16.)
const compat = new FlatCompat({ baseDirectory: __dirname })

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.amplify/**',
      '.npm-cache/**',
      'out/**',
      'build/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'amplify_outputs.json',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'dangerouslySetInnerHTML is banned. Render Markdown through <MarkdownContent/> ' +
            '(react-markdown + rehype-sanitize), which never produces an HTML string. ' +
            'The only sanctioned exceptions are src/components/seo/json-ld.tsx and the ' +
            'theme bootstrap script, both of which carry a file-scoped eslint-disable.',
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'eval() is banned.',
        },
        {
          // className only. `sizes="… 100vw"` on next/image is a legitimate
          // image-source descriptor, not a CSS width, and must not be caught.
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(^|[^a-z-])100vw($|[^a-z-])/]",
          message:
            '100vw includes the scrollbar width and causes horizontal overflow. ' +
            'Use w-full, or 100dvw where a viewport unit is genuinely required.',
        },
      ],

      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'rehype-raw',
              message:
                'rehype-raw re-enables inline HTML inside Markdown, which is the ' +
                'UGC/editor XSS vector this codebase is built to make impossible. Banned.',
            },
          ],
        },
      ],

      'react/jsx-no-target-blank': ['error', { enforceDynamicLinks: 'always' }],
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // This file necessarily contains the literals it bans, inside the rule
  // definitions themselves.
  {
    files: ['eslint.config.mjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // Tests and scripts are held to a looser standard than shipped code.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // APPSYNC_JS resolvers run in the AppSync JS runtime, not Node. They are
  // uploaded verbatim and may only import '@aws-appsync/utils'.
  {
    files: ['amplify/data/resolvers/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: { console: 'readonly' },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AwaitExpression',
          message: 'APPSYNC_JS has no async/await. Use the request/response resolver shape.',
        },
        {
          selector: 'TryStatement',
          message: 'APPSYNC_JS has no try/catch. Check ctx.error and call util.error().',
        },
        {
          selector: 'ThrowStatement',
          message: 'APPSYNC_JS has no throw. Use util.error().',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'APPSYNC_JS has no Date constructor. Use util.time.nowISO8601().',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'APPSYNC_JS has no Math.random(). Use util.autoId().',
        },
      ],
    },
  },

  // Must stay last: disables stylistic rules that fight Prettier.
  prettier,
]

export default eslintConfig
