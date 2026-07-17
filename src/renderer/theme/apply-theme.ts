/**
 * Zastosowanie motywu w rendererze (Etap 5).
 *
 * Zmienne CSS ustawiane inline na `:root` nadpisują wartości domyślne z _tokens.scss,
 * więc motyw zmienia cały wygląd bez przeładowania. Kolory terminala idą osobno do xterm
 * (patrz TerminalView) — CSS ich nie kontroluje.
 */

import { themeToCssVars, type Theme } from '@core/theme/theme';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeToCssVars(theme))) {
    root.style.setProperty(name, value);
  }

  // Tapeta: obraz i przyciemnienie na tle całej aplikacji (widoczne przez panele glass).
  // Przełącznik data-wallpaper włącza warstwy ::before/::after na .app.
  if (theme.wallpaper) {
    root.style.setProperty('--term-wallpaper', `url("${theme.wallpaper.dataUrl}")`);
    root.style.setProperty('--term-dim', String(theme.wallpaper.dim));
    root.dataset.wallpaper = 'true';
  } else {
    root.style.removeProperty('--term-wallpaper');
    root.style.removeProperty('--term-dim');
    delete root.dataset.wallpaper;
  }
}
