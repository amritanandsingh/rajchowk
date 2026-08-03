// Tailwind CSS v4 needs nothing else here: no autoprefixer (Lightning CSS
// handles vendor prefixing) and no tailwind.config.js (theme tokens live in
// `@theme` inside src/app/globals.css).
const config = {
  plugins: ['@tailwindcss/postcss'],
}

export default config
