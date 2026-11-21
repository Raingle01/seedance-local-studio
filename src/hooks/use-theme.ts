import { useCallback, useEffect, useState } from 'react';
import { prefersDarkMedia, readThemePreference, resolveTheme, saveThemePreference, type ResolvedTheme, type ThemePreference } from '@/lib/theme';

const THEME_COLORS: Record<ResolvedTheme, string> = { dark: '#141719', light: '#f7f8f7' };

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme());

  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    applyTheme(next);
  }, [preference]);

  useEffect(() => {
    if (preference !== 'system') return;
    const media = prefersDarkMedia();
    const onChange = (event: MediaQueryListEvent) => {
      const next: ResolvedTheme = event.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const toggle = useCallback(() => {
    setPreference(previous => {
      const next: ThemePreference = resolveTheme(previous) === 'dark' ? 'light' : 'dark';
      saveThemePreference(next);
      return next;
    });
  }, []);

  return { preference, resolved, toggle };
}
