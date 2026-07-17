/**
 * Model motywu i konwersja na zmienne CSS (Etap 5).
 *
 * Czysta logika w `core` — bez DOM. Renderer stosuje wynik `themeToCssVars` na `:root`.
 * Format odpowiada docs/architecture/03-interfejs-i-motywy.md (sekcja o motywach JSON).
 */

export interface Theme {
  id: string;
  name: string;
  colors: {
    bgBase: string;
    bgPanel: string;
    accent: string;
    accentDark: string;
    accentNeon: string;
    text: string;
    textMuted: string;
    border: string;
  };
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selection: string;
  };
  effects: {
    /** Promień zaokrągleń w px. */
    borderRadius: number;
    /** Rozmycie szkła (backdrop-filter) w px — nakładki nad terminalem. */
    blur: number;
    /** Mnożnik przezroczystości powierzchni glass (0–1). */
    opacity: number;
    /** Kąt gradientu powierzchni glass w stopniach. */
    gradientAngle: number;
  };
  /** Tapeta terminala: obraz (data URL) i poziom przyciemnienia (0–1). */
  wallpaper?: {
    dataUrl: string;
    dim: number;
  };
}

/** Zmienne CSS ustawiane na `:root`. Nazwy zgodne z _tokens.scss. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  return {
    '--bg-base': theme.colors.bgBase,
    '--bg-panel': theme.colors.bgPanel,
    '--accent': theme.colors.accent,
    '--accent-dark': theme.colors.accentDark,
    '--accent-neon': theme.colors.accentNeon,
    '--text': theme.colors.text,
    '--text-muted': theme.colors.textMuted,
    '--border': theme.colors.border,
    '--term-bg': theme.terminal.background,
    '--term-fg': theme.terminal.foreground,
    '--term-cursor': theme.terminal.cursor,
    '--term-selection': theme.terminal.selection,
    '--radius': `${theme.effects.borderRadius}px`,
    '--glass-blur': `${theme.effects.blur}px`,
    '--glass-opacity': `${theme.effects.opacity}`,
    '--glass-angle': `${theme.effects.gradientAngle}deg`
  };
}

export const DARK_GREEN_GLASS: Theme = {
  id: 'dark-green-glass',
  name: 'Dark Green Glass',
  colors: {
    bgBase: '#07110d',
    bgPanel: '#0b1913',
    accent: '#21e68a',
    accentDark: '#0b8f58',
    accentNeon: '#66ffb3',
    text: '#e7fff3',
    textMuted: '#8cb8a3',
    border: 'rgba(90, 255, 170, 0.18)'
  },
  terminal: {
    background: '#06100c',
    foreground: '#dffff0',
    cursor: '#21e68a',
    selection: 'rgba(33, 230, 138, 0.25)'
  },
  effects: { borderRadius: 12, blur: 12, opacity: 1, gradientAngle: 135 }
};

const MIDNIGHT_BLUE: Theme = {
  id: 'midnight-blue',
  name: 'Midnight Blue',
  colors: {
    bgBase: '#070d16',
    bgPanel: '#0b1524',
    accent: '#4aa3ff',
    accentDark: '#1d5fb0',
    accentNeon: '#8ac6ff',
    text: '#e7f1ff',
    textMuted: '#8ca3c0',
    border: 'rgba(90, 160, 255, 0.18)'
  },
  terminal: {
    background: '#060b13',
    foreground: '#dfeaff',
    cursor: '#4aa3ff',
    selection: 'rgba(74, 163, 255, 0.25)'
  },
  effects: { borderRadius: 12, blur: 12, opacity: 1, gradientAngle: 135 }
};

const AMBER_CRT: Theme = {
  id: 'amber-crt',
  name: 'Amber CRT',
  colors: {
    bgBase: '#140d03',
    bgPanel: '#1e1405',
    accent: '#ffb020',
    accentDark: '#b0740b',
    accentNeon: '#ffd071',
    text: '#fff2d8',
    textMuted: '#c0a878',
    border: 'rgba(255, 176, 32, 0.18)'
  },
  terminal: {
    background: '#100a02',
    foreground: '#ffe9c0',
    cursor: '#ffb020',
    selection: 'rgba(255, 176, 32, 0.25)'
  },
  effects: { borderRadius: 12, blur: 12, opacity: 1, gradientAngle: 135 }
};

/** Motywy dostarczone z aplikacją. Pierwszy jest domyślny. */
export const BUILT_IN_THEMES: Theme[] = [DARK_GREEN_GLASS, MIDNIGHT_BLUE, AMBER_CRT];
