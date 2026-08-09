/**
 * Globals installed by the inline pre-paint scripts.
 *
 * `__rcApplyTheme` is defined by the bootstrap in
 * src/components/theme-script.tsx. It exists so that useTheme() can re-run the
 * exact same light/dark decision rather than duplicating it — the toggle and
 * the first paint drifting apart is what let the browser chrome contradict the
 * page. Optional because the script is wrapped in try/catch and a hostile
 * environment may have skipped it.
 */
declare global {
  interface Window {
    __rcApplyTheme?: () => void
  }
}

export {}
