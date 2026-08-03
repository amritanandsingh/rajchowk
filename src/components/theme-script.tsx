/* eslint-disable no-restricted-syntax --
 * Sanctioned dangerouslySetInnerHTML #1 of 2 (the other is seo/json-ld.tsx).
 *
 * This is a build-time constant string with no interpolation of any kind — no
 * props, no request data, no database values reach it. It must be inline and
 * render-blocking: any other approach produces a flash of the wrong theme on
 * every statically-generated page load.
 */

/**
 * Applies the persisted theme before first paint.
 *
 * Runs before React hydrates, reads localStorage, and falls back to the OS
 * setting. Kept deliberately tiny — it blocks rendering.
 */
const THEME_BOOTSTRAP = `(function(){try{
var s=localStorage.getItem('rc-theme');
var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark',d);
document.documentElement.style.colorScheme=d?'dark':'light';
}catch(e){}})()`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
}

export const THEME_STORAGE_KEY = 'rc-theme'
