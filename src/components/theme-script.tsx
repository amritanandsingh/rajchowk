/* eslint-disable no-restricted-syntax --
 * Sanctioned dangerouslySetInnerHTML #1 of 2 (the other is seo/json-ld.tsx).
 *
 * This is a build-time constant string. The only interpolation is two hex
 * literals derived from our own design tokens by oklchToHex() — no props, no
 * request data, no database values reach it. It must be inline and
 * render-blocking: any other approach produces a flash of the wrong theme on
 * every statically-generated page load.
 */
import { BG_DARK_HEX, BG_LIGHT_HEX } from '@/lib/design/brand'

export const THEME_STORAGE_KEY = 'rc-theme'

/** The three states the toggle cycles through. `system` means "follow the OS". */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * Applies the persisted theme before first paint, and keeps the browser chrome
 * in agreement with it.
 *
 * Two things this fixes beyond the original:
 *
 *  1. `<meta name="theme-color">` used to be declared in layout.tsx keyed off
 *     `prefers-color-scheme`. But the theme is a MANUAL class toggle persisted
 *     in localStorage, so a reader on a dark-OS device who forced light mode got
 *     a dark chrome bar above a light page. The meta tag is now written from the
 *     same decision that sets the class, so the two cannot disagree.
 *
 *  2. There is a real `system` state. Previously the first click on the toggle
 *     wrote 'light' or 'dark' forever and the OS preference was never consulted
 *     again — there was no way back short of clearing site data. Absent or
 *     'system' now means follow the OS, and the media listener below reacts if
 *     the OS flips while the tab is open.
 *
 * Kept deliberately small — it blocks rendering.
 */
const THEME_BOOTSTRAP = `(function(){
var LIGHT=${JSON.stringify(BG_LIGHT_HEX)},DARK=${JSON.stringify(BG_DARK_HEX)};
function apply(){try{
var s=null;try{s=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}
var q=window.matchMedia('(prefers-color-scheme: dark)');
var d=s==='dark'||(s!=='light'&&q.matches);
var r=document.documentElement;
r.classList.toggle('dark',d);
r.style.colorScheme=d?'dark':'light';
var m=document.querySelector('meta[name="theme-color"]');
if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m)}
m.setAttribute('content',d?DARK:LIGHT);
}catch(e){}}
apply();
// Only matters while the preference is 'system'; apply() re-reads it each time.
try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',apply)}catch(e){}
window.__rcApplyTheme=apply;
})()`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
}
