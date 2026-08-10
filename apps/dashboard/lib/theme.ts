'use client';

import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY as STORAGE_KEY } from './theme-script';

export type Theme = 'light' | 'dark';

/**
 * Small hook that keeps the current theme in sync with the <html>
 * class and localStorage. The initial class was set by the inline
 * script in <head> (see layout.tsx) so React never renders the wrong
 * theme on first paint.
 */
export function useTheme(): [Theme, (t: Theme) => void, () => void] {
  const [theme, setTheme] = useState<Theme>('dark');

  // Read the truth from <html> class (set by the inline script)
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const apply = (t: Theme) => {
    setTheme(t);
    const root = document.documentElement;
    if (t === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {}
  };

  const toggle = () => apply(theme === 'dark' ? 'light' : 'dark');

  return [theme, apply, toggle];
}
