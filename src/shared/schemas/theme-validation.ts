/**
 * Walidacja motywów.
 *
 * Używana przy odczycie pliku motywu (import — dane niezaufane) i przy zapisie z renderera.
 * Wartości kolorów trafiają do zmiennych CSS, więc są odkażane ze znaków składni CSS.
 */

import type { Theme } from '@core/theme/theme';

export class ThemeValidationError extends Error {
  constructor(message: string) {
    super(`Nieprawidłowy motyw: ${message}`);
    this.name = 'ThemeValidationError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ThemeValidationError('oczekiwano obiektu');
  }
  return value as Record<string, unknown>;
}

/**
 * Kolor: dozwolone tylko bezpieczne znaki (hex, rgb/rgba, hsl, nazwy). Odcinamy wszystko,
 * co mogłoby wstrzyknąć własne reguły CSS (`;`, `{`, `}`, `url(`, cudzysłowy).
 */
function color(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new ThemeValidationError(`kolor "${key}" musi być tekstem`);
  const cleaned = value.replace(/[^#0-9a-zA-Z.,%()\s-]/g, '').trim();
  if (!cleaned) throw new ThemeValidationError(`kolor "${key}" pusty po odkażeniu`);
  return cleaned.slice(0, 64);
}

function str(source: Record<string, unknown>, key: string, max: number): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ThemeValidationError(`pole "${key}" musi być niepustym tekstem`);
  }
  // Identyfikator/nazwa: bez znaków składni CSS/HTML.
  return value.replace(/[<>{};]/g, '').slice(0, max);
}

/** Waliduje pełny motyw. Rzuca przy braku wymaganego pola. */
export function parseTheme(payload: unknown): Theme {
  const src = record(payload);
  const colors = record(src['colors']);
  const terminal = record(src['terminal']);
  const effects = record(src['effects'] ?? {});
  const radius = effects['borderRadius'];

  return {
    id: str(src, 'id', 64),
    name: str(src, 'name', 80),
    colors: {
      bgBase: color(colors, 'bgBase'),
      bgPanel: color(colors, 'bgPanel'),
      accent: color(colors, 'accent'),
      accentDark: color(colors, 'accentDark'),
      accentNeon: color(colors, 'accentNeon'),
      text: color(colors, 'text'),
      textMuted: color(colors, 'textMuted'),
      border: color(colors, 'border')
    },
    terminal: {
      background: color(terminal, 'background'),
      foreground: color(terminal, 'foreground'),
      cursor: color(terminal, 'cursor'),
      selection: color(terminal, 'selection')
    },
    effects: {
      borderRadius: typeof radius === 'number' && radius >= 0 && radius <= 32 ? radius : 12
    }
  };
}
