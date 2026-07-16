/**
 * Ustawienia terminala (Etap 1 — zakres podstawowy).
 *
 * Motywy, gradienty i personalizacja szkła wchodzą w Etapie 5
 * (docs/architecture/08-roadmapa.md).
 */

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  /** Mnożnik wysokości wiersza, nie wartość w pikselach. */
  lineHeight: number;
  letterSpacing: number;
  cursorBlink: boolean;
  /** Liczba linii historii przewijania trzymanych w buforze. */
  scrollback: number;
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontFamily: 'Cascadia Mono',
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorBlink: true,
  scrollback: 5000
};

/**
 * Granice wartości.
 *
 * Jedno źródło prawdy dla walidacji w procesie głównym i dla suwaków w interfejsie —
 * dzięki temu UI nie pozwoli wysłać czegoś, co i tak zostanie odrzucone.
 */
export const SETTINGS_LIMITS = {
  fontSize: { min: 6, max: 48 },
  lineHeight: { min: 1, max: 3 },
  letterSpacing: { min: -2, max: 8 },
  scrollback: { min: 0, max: 200_000 },
  fontFamilyMaxLength: 120
} as const;
