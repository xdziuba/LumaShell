/**
 * Testy jednostkowe walidacji specyfikacji portu szeregowego (Etap 4).
 *
 * Uruchomienie: node --experimental-transform-types tests/unit/serial-validation.test.ts
 */

import { parseTerminalCreate, IpcValidationError } from '../../src/shared/schemas/ipc-validation.ts';

const wyniki: Array<{ n: string; ok: boolean }> = [];
const sprawdz = (n: string, ok: boolean): void => {
  wyniki.push({ n, ok });
};

const create = (spec: unknown) => parseTerminalCreate({ spec, columns: 80, rows: 24 });

// Pełna, poprawna ramka.
{
  const s = create({ kind: 'serial', path: 'COM9', baudRate: 115200, dataBits: 7, stopBits: 2, parity: 'even', rtscts: true });
  sprawdz('pełna ramka: baud', s.spec.kind === 'serial' && s.spec.baudRate === 115200);
  sprawdz('pełna ramka: dataBits', s.spec.kind === 'serial' && s.spec.dataBits === 7);
  sprawdz('pełna ramka: stopBits', s.spec.kind === 'serial' && s.spec.stopBits === 2);
  sprawdz('pełna ramka: parity', s.spec.kind === 'serial' && s.spec.parity === 'even');
  sprawdz('pełna ramka: rtscts', s.spec.kind === 'serial' && s.spec.rtscts === true);
}

// Minimalna ramka — same wymagane pola.
{
  const s = create({ kind: 'serial', path: 'COM1', baudRate: 9600 });
  sprawdz('minimalna ramka bez opcji przechodzi', s.spec.kind === 'serial' && s.spec.dataBits === undefined);
}

// Błędne wartości ramki są POMIJANE (transport użyje 8N1), nie wywracają walidacji.
{
  const s = create({ kind: 'serial', path: 'COM1', baudRate: 9600, dataBits: 99, parity: 'xyz', stopBits: 3 });
  sprawdz('błędny dataBits pominięty', s.spec.kind === 'serial' && s.spec.dataBits === undefined);
  sprawdz('błędna parity pominięta', s.spec.kind === 'serial' && s.spec.parity === undefined);
  sprawdz('błędny stopBits pominięty', s.spec.kind === 'serial' && s.spec.stopBits === undefined);
}

// Niedozwolona prędkość → wyjątek.
{
  let rzucil = false;
  try {
    create({ kind: 'serial', path: 'COM1', baudRate: 12345 });
  } catch (e) {
    rzucil = e instanceof IpcValidationError;
  }
  sprawdz('niedozwolony baudRate rzuca', rzucil);
}

// Zła ścieżka (nie COM<n>) → wyjątek. Renderer nie może podać dowolnej ścieżki.
{
  let rzucil = false;
  try {
    create({ kind: 'serial', path: '/dev/ttyUSB0', baudRate: 9600 });
  } catch (e) {
    rzucil = e instanceof IpcValidationError;
  }
  sprawdz('ścieżka spoza COM<n> rzuca', rzucil);
}

console.log('WYNIKI (walidacja portu szeregowego)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
