/**
 * Walidacja ustawień.
 *
 * Używana w dwóch miejscach: przy ładowaniu pliku z dysku (mógł zostać ręcznie
 * popsuty) i przy przyjmowaniu zmian z renderera (ładunek IPC jest niezaufany —
 * docs/security/01-model-procesow.md).
 */

import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  type TerminalSettings
} from '@shared/types/settings';

function liczba(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Nazwa rodziny czcionek trafia prosto do CSS, więc znaki składni CSS są usuwane.
 * Bez tego wartość z konfiguracji mogłaby wstrzyknąć własne reguły.
 */
function rodzinaCzcionek(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.fontFamily;
  const oczyszczona = value.replace(/[^\w\s\-,'"]/g, '').trim();
  if (!oczyszczona) return DEFAULT_SETTINGS.fontFamily;
  return oczyszczona.slice(0, SETTINGS_LIMITS.fontFamilyMaxLength);
}

/**
 * Zamienia dowolne dane w poprawne ustawienia.
 *
 * Nigdy nie rzuca — brakujące lub błędne pola schodzą do wartości domyślnej. Popsuty
 * plik konfiguracyjny nie może uniemożliwić uruchomienia terminala.
 */
export function parseSettings(payload: unknown): TerminalSettings {
  const source =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  return {
    fontFamily: rodzinaCzcionek(source['fontFamily']),
    fontSize: liczba(
      source['fontSize'],
      DEFAULT_SETTINGS.fontSize,
      SETTINGS_LIMITS.fontSize.min,
      SETTINGS_LIMITS.fontSize.max
    ),
    lineHeight: liczba(
      source['lineHeight'],
      DEFAULT_SETTINGS.lineHeight,
      SETTINGS_LIMITS.lineHeight.min,
      SETTINGS_LIMITS.lineHeight.max
    ),
    letterSpacing: liczba(
      source['letterSpacing'],
      DEFAULT_SETTINGS.letterSpacing,
      SETTINGS_LIMITS.letterSpacing.min,
      SETTINGS_LIMITS.letterSpacing.max
    ),
    cursorBlink:
      typeof source['cursorBlink'] === 'boolean'
        ? source['cursorBlink']
        : DEFAULT_SETTINGS.cursorBlink,
    scrollback: Math.round(
      liczba(
        source['scrollback'],
        DEFAULT_SETTINGS.scrollback,
        SETTINGS_LIMITS.scrollback.min,
        SETTINGS_LIMITS.scrollback.max
      )
    ),
    serialMacros: makra(source['serialMacros']),
    recentDirs: katalogi(source['recentDirs'])
  };
}

/**
 * Ostatnie katalogi: teksty przycięte co do długości i liczby, bez duplikatów.
 *
 * To tylko podpowiedź dla interfejsu — istnienie katalogu sprawdza dopiero spawn powłoki,
 * a ścieżka i tak przechodzi przez walidację SessionSpec przy tworzeniu sesji.
 */
function katalogi(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    const path = entry.slice(0, SETTINGS_LIMITS.dirMaxLength);
    if (!out.includes(path)) out.push(path);
    if (out.length >= SETTINGS_LIMITS.recentDirsMaxCount) break;
  }
  return out;
}

/** Makra: tablica niepustych tekstów, przycięta co do długości i liczby. */
function makra(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m): m is string => typeof m === 'string' && m.length > 0)
    .map((m) => m.slice(0, SETTINGS_LIMITS.macroMaxLength))
    .slice(0, SETTINGS_LIMITS.macroMaxCount);
}
