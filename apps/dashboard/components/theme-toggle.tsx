'use client';

import { useTheme } from '@/lib/theme';

export function ThemeToggle() {
  const [theme, , toggle] = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className="group relative h-8 w-8 grid place-items-center rounded-md border border-border
                 text-text-2 hover:text-text hover:border-border-2 transition-colors duration-200"
    >
      {/* Sun (visible in dark mode = 'switch to light') */}
      <svg
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        className={`absolute transition-all duration-300 ease-out
                    ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-45 scale-75'}`}
        aria-hidden
      >
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
        />
      </svg>

      {/* Moon (visible in light mode = 'switch to dark') */}
      <svg
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        className={`absolute transition-all duration-300 ease-out
                    ${isDark ? 'opacity-0 rotate-45 scale-75' : 'opacity-100 rotate-0 scale-100'}`}
        aria-hidden
      >
        <path
          d="M13.5 10.2A5.5 5.5 0 0 1 5.8 2.5a5.7 5.7 0 0 0-1.1.9 5.75 5.75 0 1 0 8.8 6.8Z"
          stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
