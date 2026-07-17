/**
 * Testy jednostkowe motywu: konwersja na zmienne CSS i walidacja (Etap 5).
 *
 * Uruchomienie: node --experimental-transform-types tests/unit/theme.test.ts
 */

import { themeToCssVars, BUILT_IN_THEMES, DARK_GREEN_GLASS } from '../../src/core/theme/theme.ts';
import { parseTheme, ThemeValidationError } from '../../src/shared/schemas/theme-validation.ts';

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

// Konwersja na zmienne CSS.
{
  const vars = themeToCssVars(DARK_GREEN_GLASS);
  sprawdz('--accent z motywu', vars['--accent'] === '#21e68a', vars['--accent']);
  sprawdz('--term-bg z terminala', vars['--term-bg'] === '#06100c');
  sprawdz('--radius w px', vars['--radius'] === '12px');
}

// Wbudowane motywy: unikalne id, min. 2 warianty.
{
  const ids = BUILT_IN_THEMES.map((t) => t.id);
  sprawdz('co najmniej 2 wbudowane motywy', BUILT_IN_THEMES.length >= 2);
  sprawdz('id wbudowanych są unikalne', new Set(ids).size === ids.length);
}

// Walidacja: poprawny motyw przechodzi.
{
  const parsed = parseTheme(DARK_GREEN_GLASS);
  sprawdz('poprawny motyw waliduje', parsed.id === 'dark-green-glass' && parsed.colors.accent === '#21e68a');
}

// Odkażanie kolorów: próba wstrzyknięcia CSS jest cięta.
{
  const zlosliwy = {
    ...DARK_GREEN_GLASS,
    colors: { ...DARK_GREEN_GLASS.colors, accent: 'red; } body { background: url(http://evil) } .x {' }
  };
  const parsed = parseTheme(zlosliwy);
  sprawdz('kolor odkażony — bez średnika', !parsed.colors.accent.includes(';'), parsed.colors.accent);
  sprawdz('kolor odkażony — bez nawiasu klamrowego', !parsed.colors.accent.includes('{'), parsed.colors.accent);
}

// Brak wymaganego pola → wyjątek.
{
  let rzucil = false;
  try {
    parseTheme({ id: 'x', name: 'x', colors: {}, terminal: {}, effects: {} });
  } catch (e) {
    rzucil = e instanceof ThemeValidationError;
  }
  sprawdz('brak kolorów rzuca', rzucil);
}

// borderRadius poza zakresem → domyślne 12.
{
  const parsed = parseTheme({ ...DARK_GREEN_GLASS, effects: { borderRadius: 999 } });
  sprawdz('zły borderRadius → 12', parsed.effects.borderRadius === 12);
}

console.log('WYNIKI (motyw)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
