import { storage } from './studio';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  const value = storage.get<ThemePreference | null>(THEME_STORAGE_KEY, null);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function saveThemePreference(theme: ThemePreference) {
  storage.set(THEME_STORAGE_KEY, theme);
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference = readThemePreference()): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

export function prefersDarkMedia(): MediaQueryList {
  return window.matchMedia(DARK_MEDIA_QUERY);
}
