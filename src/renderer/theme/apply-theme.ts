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
}
