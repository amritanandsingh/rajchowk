/** @type {import("prettier").Config} */
const config = {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
  // Tailwind v4 has no tailwind.config.js, so the class sorter must be pointed
  // at the CSS entrypoint holding `@import "tailwindcss"` and `@theme`.
  // (`tailwindConfig` is the v3 option — do not use it.)
  tailwindStylesheet: './src/app/globals.css',
  tailwindFunctions: ['clsx', 'cn', 'cva', 'twMerge'],
  overrides: [
    { files: '*.md', options: { proseWrap: 'preserve' } },
    { files: '*.json', options: { singleQuote: false } },
  ],
}

export default config
