import { createContext, useContext, useEffect, useState } from 'react';

// Font stacks that resolve to nice native faces (no web fonts needed).
export const FONTS = {
  system: { label: 'System', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  rounded: { label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif' },
  serif: { label: 'Serif', stack: 'ui-serif, "New York", Georgia, "Times New Roman", serif' },
  mono: { label: 'Mono', stack: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace' },
};

const PrefsContext = createContext(null);

export function PrefsProvider({ children }) {
  const [theme, setThemeState] = useState('dark');
  const [font, setFontState] = useState('system');

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const t = localStorage.getItem('theme');
    const f = localStorage.getItem('font');
    if (t) setThemeState(t);
    if (f) setFontState(f);
  }, []);

  // Apply theme to <html data-theme>.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Apply font by overriding the --font CSS variable on the root.
  useEffect(() => {
    const stack = (FONTS[font] || FONTS.system).stack;
    document.documentElement.style.setProperty('--font', stack);
    localStorage.setItem('font', font);
  }, [font]);

  const setTheme = (t) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  const setFont = (f) => setFontState(f);

  return (
    <PrefsContext.Provider value={{ theme, setTheme, toggleTheme, font, setFont }}>
      {children}
    </PrefsContext.Provider>
  );
}

export const usePrefs = () => useContext(PrefsContext);
