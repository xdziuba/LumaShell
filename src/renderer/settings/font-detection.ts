/**
 * Wykrywanie zainstalowanych czcionek.
 *
 * Electron nie udostępnia listy czcionek systemowych, a `queryLocalFonts()` wymaga
 * zgody użytkownika i bezpiecznego kontekstu, którego strona `file://` nie ma.
 * Zostaje klasyczna sztuczka: mierzymy szerokość tekstu w badanej czcionce i w czcionce
 * zapasowej. Jeśli szerokości są identyczne, czcionka nie istnieje i przeglądarka użyła
 * zapasowej.
 */

/** Czcionki monospace spotykane na Windows — z listy zostaną tylko zainstalowane. */
const KANDYDACI = [
  'Cascadia Mono',
  'Cascadia Code',
  'Consolas',
  'Courier New',
  'Lucida Console',
  'Ubuntu Mono',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'ComicShannsMono Nerd Font'
];

/** Tekst mieszany: cyfry i litery o różnej szerokości lepiej różnicują kroje. */
const PROBKA = 'mmmmmiiiiilllll0123456789';
const ROZMIAR = 72;

export function detectInstalledFonts(): string[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [KANDYDACI[0]!];

  const zmierz = (font: string): number => {
    ctx.font = `${ROZMIAR}px ${font}`;
    return ctx.measureText(PROBKA).width;
  };

  // Trzy różne czcionki zapasowe: jeśli badana nie istnieje, jej wynik zrówna się
  // z zapasową. Porównanie z kilkoma ogranicza fałszywe trafienia.
  const zapasowe = ['monospace', 'serif', 'sans-serif'];
  const bazowe = zapasowe.map(zmierz);

  return KANDYDACI.filter((font) =>
    zapasowe.some((fallback, index) => zmierz(`"${font}", ${fallback}`) !== bazowe[index])
  );
}
