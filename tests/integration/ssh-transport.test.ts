/**
 * Test integracyjny `SshTransport` (Etap 0).
 *
 * Serwer SSH stoi w pamięci tego samego procesu (ssh2 udostępnia własną implementację
 * serwera), więc test nie wymaga zdalnego hosta, nie instaluje niczego w systemie
 * i nie wysyła danych na zewnątrz.
 *
 * Uruchomienie: node tests/integration/ssh-transport.test.ts
 *
 * Import `@core/...` w testowanym module jest wyłącznie typem, więc znika przy
 * usuwaniu typów przez Node — nie potrzeba bundlera ani mapowania aliasów.
 */

import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { SshTransport } from '../../src/services/ssh/ssh-transport.ts';

// ssh2 jest paczką CommonJS. Lekser Node wykrywa w niej `Client` jako nazwany eksport
// (z tego korzysta transport), ale `Server` już nie — stąd sięgnięcie przez default.
const { Server } = ssh2;

const GREETING = 'powitanie z serwera\r\n';
const PROBE = 'echo-test';

// Klucz hosta generowany na potrzeby testu i żyjący tylko w pamięci procesu.
// RSA w klasycznym PEM (pkcs1) — ssh2 nie parsuje ed25519 w formacie pkcs8.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
});

const results: Array<{ nazwa: string; ok: boolean; szczegol?: string }> = [];
function sprawdz(nazwa: string, ok: boolean, szczegol?: string): void {
  results.push({ nazwa, ok, szczegol });
}

const server = new Server({ hostKeys: [privateKey] }, (client) => {
  client.on('authentication', (ctx) => {
    // Prototyp: przyjmujemy dowolne hasło, testujemy transport, nie politykę haseł.
    if (ctx.method === 'password') ctx.accept();
    else ctx.reject(['password']);
  });

  client.on('ready', () => {
    client.on('session', (acceptSession) => {
      const session = acceptSession();
      session.on('pty', (accept) => accept?.());
      session.on('window-change', (accept) => accept?.());
      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        stream.write(GREETING);
        // Odbijamy wejście, żeby sprawdzić drogę w obie strony.
        stream.on('data', (chunk: Buffer) => stream.write(chunk));
      });
    });
  });
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as { port: number };
console.log(`Serwer testowy SSH: 127.0.0.1:${port}\n`);

const transport = new SshTransport('test-1', {
  host: '127.0.0.1',
  port,
  username: 'tester',
  password: 'dowolne',
  columns: 100,
  rows: 30
});

const stany: string[] = [];
transport.onStateChange((state) => stany.push(state));

let odebrane = Buffer.alloc(0);
transport.onData((chunk) => {
  odebrane = Buffer.concat([odebrane, Buffer.from(chunk)]);
  // Kontrakt obiecuje bajty — gdyby transport oddał string, ten test by to wykrył.
  sprawdz('onData oddaje Uint8Array, nie string', chunk instanceof Uint8Array);
});

function czekajNa(fragment: string, ms = 4000): Promise<boolean> {
  const koniec = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (odebrane.toString('utf8').includes(fragment)) return resolve(true);
      if (Date.now() > koniec) return resolve(false);
      setTimeout(tick, 40);
    };
    tick();
  });
}

await transport.connect();
sprawdz('connect() kończy się sukcesem', transport.state === 'connected');
sprawdz('stan przechodzi connecting → connected', stany.join(',') === 'connecting,connected', stany.join(' → '));

sprawdz('powitanie serwera dociera do transportu', await czekajNa('powitanie z serwera'));

odebrane = Buffer.alloc(0);
await transport.write(PROBE);
sprawdz('write() → dane wracają echem', await czekajNa(PROBE));

// Port szeregowy nie ma rozmiaru okna, SSH ma — kontrakt to rozróżnia przez opcjonalność.
sprawdz('resize() istnieje dla SSH', typeof transport.resize === 'function');
await transport.resize?.(120, 40);
sprawdz('resize() nie wywraca sesji', transport.state === 'connected');

await transport.disconnect();
sprawdz('disconnect() zamyka sesję', transport.state === 'closed');

// Druga próba na zamkniętym porcie serwera: ścieżka błędu musi być czysta.
await new Promise<void>((resolve) => server.close(() => resolve()));
const zerwany = new SshTransport('test-2', {
  host: '127.0.0.1',
  port,
  username: 'tester',
  password: 'dowolne'
});
let rzucil = false;
try {
  await zerwany.connect();
} catch {
  rzucil = true;
}
sprawdz('nieudane połączenie rzuca błąd', rzucil);
sprawdz('nieudane połączenie ustawia stan error', zerwany.state === 'error');

console.log('WYNIKI');
console.log('─'.repeat(56));
for (const r of results) {
  console.log(`${r.ok ? '  OK  ' : ' BLAD '} ${r.nazwa}${r.szczegol ? `  (${r.szczegol})` : ''}`);
}
console.log('─'.repeat(56));
const bledy = results.filter((r) => !r.ok).length;
console.log(bledy === 0 ? `Wszystkie ${results.length} sprawdzeń przeszło.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
