/**
 * Test sprzętowy `SerialTransport` (Etap 0).
 *
 * Wymaga fizycznego portu — nie nadaje się do CI, uruchamiany ręcznie:
 *   node --experimental-transform-types tests/integration/serial-transport.test.ts COM9 115200
 *
 * Test jest **wyłącznie do odczytu**: otwiera port, nasłuchuje i zamyka. Nie wysyła
 * ani jednego bajtu do urządzenia — zgodnie z profilem ryzyka `read-only`
 * (docs/security/03-polityka-agenta.md).
 *
 * Uwaga: samo otwarcie portu przestawia linie DTR/RTS, co na części układów wywołuje
 * reset. Uruchamiać świadomie.
 */

import { SerialTransport, listSerialPorts } from '../../src/services/serial/serial-transport.ts';

const path = process.argv[2];
const baudRate = Number(process.argv[3] ?? 115200);

if (!path) {
  console.error('Podaj port, np.: ... serial-transport.test.ts COM9 115200');
  process.exit(2);
}

const NASLUCH_MS = 5000;
const wyniki: Array<{ nazwa: string; ok: boolean; szczegol?: string }> = [];
const sprawdz = (nazwa: string, ok: boolean, szczegol?: string): void => {
  wyniki.push({ nazwa, ok, szczegol });
};

const porty = await listSerialPorts();
console.log('Wykryte porty:');
for (const p of porty) console.log(`   ${p.path.padEnd(6)} ${p.friendlyName ?? p.manufacturer ?? ''}`);
console.log('');
sprawdz('listSerialPorts() widzi żądany port', porty.some((p) => p.path === path), path);

const transport = new SerialTransport('hw-1', { path, baudRate });
const stany: string[] = [];
transport.onStateChange((s) => stany.push(s));
transport.onError((e) => console.log('   [błąd transportu]', e.message));

let bajty = 0;
let porcje = 0;
let bajtyTekstowe = true;
let probka = Buffer.alloc(0);

transport.onData((chunk) => {
  porcje += 1;
  bajty += chunk.length;
  sprawdz('onData oddaje Uint8Array, nie string', chunk instanceof Uint8Array);
  if (probka.length < 200) probka = Buffer.concat([probka, Buffer.from(chunk)]);
  for (const b of chunk) if (b > 127) bajtyTekstowe = false;
});

console.log(`Otwieram ${path} @ ${baudRate} (tylko odczyt, ${NASLUCH_MS / 1000}s)…`);
await transport.connect();
sprawdz('connect() otwiera port', transport.state === 'connected');
sprawdz('stan: connecting → connected', stany.join(',') === 'connecting,connected', stany.join(' → '));

await new Promise((r) => setTimeout(r, NASLUCH_MS));

await transport.disconnect();
sprawdz('disconnect() zamyka port', transport.state === 'closed');

// Port szeregowy nie ma pojęcia rozmiaru okna — kontrakt oddaje to opcjonalnością.
sprawdz('resize() nie istnieje dla portu szeregowego', transport.resize === undefined);

console.log('');
console.log(`Odebrano: ${bajty} B w ${porcje} porcjach`);
if (bajty > 0) {
  console.log(`Dane wyglądają na: ${bajtyTekstowe ? 'tekst ASCII' : 'binarne (są bajty >127)'}`);
  console.log('Próbka:', JSON.stringify(probka.toString('utf8').slice(0, 120)));
} else {
  console.log('Cisza na porcie — urządzenie nic nie nadaje samo z siebie.');
  console.log('To nie jest błąd: otwarcie i zamknięcie portu i tak zostało sprawdzone.');
}

console.log('');
console.log('WYNIKI');
console.log('─'.repeat(52));
for (const w of wyniki) {
  console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.nazwa}${w.szczegol ? `  (${w.szczegol})` : ''}`);
}
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} sprawdzeń przeszło.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
