import { useEffect } from 'react';
import { create } from 'zustand';
import { useSettings } from '@/store/settings';

interface ThemeState {
  isDark: boolean;
  setDark: (dark: boolean) => void;
}

export const useThemeState = create<ThemeState>((set) => ({
  isDark: document.documentElement.classList.contains('dark'),
  setDark: (isDark) => set({ isDark }),
}));

/** Applies theme + font size to the document; call once at the app root. */
export function useApplyTheme() {
  const theme = useSettings((s) => s.settings.theme);
  const fontSize = useSettings((s) => s.settings.fontSize);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || theme === 'dark-slate' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('dark-slate', theme === 'dark-slate');
      useThemeState.getState().setDark(dark);
      try {
        localStorage.setItem('yl-theme', theme);
      } catch {
        // storage may be unavailable; the pre-paint script just won't help
      }
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
  }, [fontSize]);
}
