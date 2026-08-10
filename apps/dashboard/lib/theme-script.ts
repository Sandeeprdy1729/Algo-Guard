// Server-safe module. No 'use client' — imported by the root layout,
// which is a server component. Do NOT add React/DOM imports here.

export const THEME_STORAGE_KEY = 'agentguard-theme';

/**
 * Emitted verbatim in <head> so the correct class is applied BEFORE
 * React hydrates → no flash of wrong theme.
 *  - honours an explicit localStorage choice
 *  - otherwise falls back to `prefers-color-scheme`
 *  - defaults to dark
 */
export const THEME_HYDRATION_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
    }
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`.trim();
