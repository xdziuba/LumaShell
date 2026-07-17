/**
 * Test integracyjny weryfikacji klucza hosta SSH (Etap 3).
 *
 * Serwer SSH w pamięci procesu (ssh2), bez zdalnego hosta. Sprawdza model TOFU:
 *   1. nieznany host → zapamiętanie odcisku, połączenie przechodzi
 *   2. ponowne połączenie tym samym kluczem → zaufany
 *   3. inny klucz na tym samym host:port → 'changed' → połączenie odrzucone (MITM)
 *
 * Uruchomienie: node --experimental-transform-types tests/integration/known-hosts.test.ts
 */

import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { SshTransport } from '../../src/services/ssh/ssh-transport.ts';
import { evaluateHost, hostKey } from '../../src/core/ssh/known-hosts.ts';
import { fingerprint } from '../../src/main/ssh/host-fingerprint.ts';

const { Server } = ssh2;

function hostKeyPem() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  }).privateKey;
}

function startServer(privateKey: string, port: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    // Odrzucenie klucza hosta przez klienta zrywa połączenie — serwer dostaje wtedy
    // 'error'. Bez tego handlera nieobsłużone zdarzenie wywala proces testu.
    client.on('error', () => {});
    client.on('authentication', (ctx) => ctx.accept());
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('pty', (accept) => accept?.());
        session.on('shell', (acceptShell) => acceptShell().write('ok\r\n'));
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ port: addr.port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

// Nasz magazyn known_hosts na potrzeby testu (w pamięci).
const store = new Map<string, string>();

/** Polityka TOFU: nieznany → zapamiętaj i akceptuj, zaufany → akceptuj, zmieniony → odrzuć. */
function makeVerifier(host: string, port: number) {
  return async (key: Uint8Array): Promise<boolean> => {
    const fp = fingerprint(Buffer.from(key));
    const trust = evaluateHost(store.get(hostKey(host, port)), fp);
    if (trust === 'unknown') {
      store.set(hostKey(host, port), fp);
      return true;
    }
    return trust === 'trusted';
  };
}

// --- Krok 1: nieznany host (TOFU) ---
const key1 = hostKeyPem();
const s1 = await startServer(key1, 0);
const port = s1.port;

const t1 = new SshTransport('t1', {
  host: '127.0.0.1',
  port,
  username: 'u',
  password: 'x',
  verifyHost: makeVerifier('127.0.0.1', port)
});
await t1.connect();
sprawdz('nieznany host → połączenie przechodzi (TOFU)', t1.state === 'connected');
sprawdz('odcisk zapamiętany', store.has(hostKey('127.0.0.1', port)));
sprawdz('odcisk w formacie OpenSSH', (store.get(hostKey('127.0.0.1', port)) ?? '').startsWith('SHA256:'));
const zapamietanyOdcisk = store.get(hostKey('127.0.0.1', port));
await t1.disconnect();

// --- Krok 2: ten sam klucz → zaufany ---
const t2 = new SshTransport('t2', {
  host: '127.0.0.1',
  port,
  username: 'u',
  password: 'x',
  verifyHost: makeVerifier('127.0.0.1', port)
});
await t2.connect();
sprawdz('ten sam klucz → zaufany, łączy się', t2.state === 'connected');
await t2.disconnect();
await s1.close();

// --- Krok 3: INNY klucz na tym samym host:port → odrzucenie ---
const key2 = hostKeyPem();
const s2 = await startServer(key2, port); // ten sam port, inny klucz hosta
let odrzucone = false;
const t3 = new SshTransport('t3', {
  host: '127.0.0.1',
  port,
  username: 'u',
  password: 'x',
  verifyHost: makeVerifier('127.0.0.1', port)
});
try {
  await t3.connect();
} catch {
  odrzucone = true;
}
sprawdz('zmieniony klucz → połączenie odrzucone (MITM)', odrzucone);
sprawdz('zmieniony klucz → stan error', t3.state === 'error');
sprawdz('odcisk NIE nadpisany po cichu', store.get(hostKey('127.0.0.1', port)) === zapamietanyOdcisk);
await s2.close();

console.log('WYNIKI (weryfikacja klucza hosta)');
console.log('─'.repeat(56));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(56));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
