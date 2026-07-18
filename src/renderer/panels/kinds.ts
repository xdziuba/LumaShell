/**
 * Rodzaje paneli otwieranych jako osobne zakładki (Etap UI).
 *
 * Panel to zakładka bez sesji terminala — zastępuje terminal, gdy jest aktywna. Tytuł idzie
 * na zakładkę; ikonę dobiera TabBar. Trzymane osobno, żeby store i komponenty paneli mogły
 * importować typ bez cyklu.
 */

export type PanelKind = 'settings' | 'themes' | 'plugins' | 'ai' | 'about' | 'shortcuts' | 'whatsnew';

export const PANEL_TITLES: Record<PanelKind, string> = {
  settings: 'Ustawienia',
  themes: 'Motywy',
  plugins: 'Wtyczki',
  ai: 'Agent AI',
  about: 'O aplikacji',
  shortcuts: 'Skróty klawiszowe',
  whatsnew: 'Nowości'
};
