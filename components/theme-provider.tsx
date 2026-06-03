'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'testpilot-theme';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  // On mount: read stored preference or fall back to system preference
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') {
      apply(stored);
      setTheme(stored);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const initial: Theme = prefersDark ? 'dark' : 'light';
      apply(initial);
      setTheme(initial);
    }
  }, []);

  function apply(t: Theme) {
    if (t === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }

  function toggle() {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      apply(next);
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
