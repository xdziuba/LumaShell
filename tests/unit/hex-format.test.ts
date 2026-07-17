/**
 * Testy jednostkowe formatera hex i znaczników czasu (Etap 4).
 *
 * Uruchomienie: node --experimental-transform-types tests/unit/hex-format.test.ts
 */

import { HexFormatter, timestamp } from '../../src/renderer/terminal/hex-format.ts';

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

// Pełna linia 16 bajtów "Hello world" + dopełnienie.
{
  const f = new HexFormatter();
  const bytes = new TextEncoder().encode('Hello, world!123'); // dokładnie 16 bajtów
  const out = f.push(bytes);
  sprawdz('16 bajtów → jedna linia', out.split('\r\n').filter(Boolean).length === 1, JSON.stringify(out.trim()));
  sprawdz('offset zaczyna od 00000000', out.startsWith('00000000  '));
  sprawdz('zawiera hex 48 (H)', out.includes('48'));
  sprawdz('kolumna ASCII zawiera tekst', out.includes('|Hello, world!123|'));
}

// Bufor: 10 bajtów nie tworzy pełnej linii, dopiero flush.
{
  const f = new HexFormatter();
  const out1 = f.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  sprawdz('10 bajtów → brak pełnej linii', out1 === '', JSON.stringify(out1));
  const flushed = f.flush();
  sprawdz('flush domyka niepełną linię', flushed.startsWith('00000000  ') && flushed.includes('|'));
}

// Ciągłość offsetu między porcjami: 20 bajtów = 1 pełna linia teraz, reszta później.
{
  const f = new HexFormatter();
  const first = f.push(new Uint8Array(20)); // 16 → linia, 4 w buforze
  sprawdz('20 bajtów → jedna pełna linia', first.split('\r\n').filter(Boolean).length === 1);
  const rest = f.push(new Uint8Array(16)); // 4+16=20 → jeszcze jedna pełna linia, 4 zostają
  sprawdz('druga porcja kontynuuje offset', rest.includes('00000010'), rest.trim());
}

// Bajty niedrukowalne → kropki w kolumnie ASCII.
{
  const f = new HexFormatter();
  const out = f.push(new Uint8Array([0, 1, 2, 255, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76]));
  sprawdz('niedrukowalne jako kropki', out.includes('|....ABCDEFGHIJKL|'), out.trim());
}

// Znacznik czasu ma format [HH:MM:SS.mmm].
{
  const ts = timestamp(new Date(2020, 0, 1, 9, 5, 3, 7));
  sprawdz('timestamp format', ts === '[09:05:03.007] ', ts);
}

console.log('WYNIKI (formater hex)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
