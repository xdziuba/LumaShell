/**
 * Test E2E wznawiania połączenia SSH.
 *
 * Serwer ssh2 działa w TYM procesie, więc test może zerwać aktywne połączenie i sprawdzić,
 * że transport je wznawia. Aplikacja łączy się z 127.0.0.1 hostowanym tutaj.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
});

let activeClient = null;
let greetCount = 0;

const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
  activeClient = client;
  client.on('error', () => {});
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () => {
    client.on('session', (acceptSession) => {
      const session = acceptSession();
      session.on('pty', (accept) => accept?.());
      session.on('shell', (acceptShell) => {
        greetCount += 1;
        acceptShell().write(`POWITANIE-${greetCount}\r\n`);
      });
    });
  });
});

const sshPort = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
console.log(`Serwer SSH w procesie testu: 127.0.0.1:${sshPort}`);

const base = 'http://127.0.0.1:9222';
const page = (await (await fetch(`${base}/json`)).json()).find(
  (t) => t.type === 'page' && t.url.includes('index.html')
);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const mid = ++id;
    pending.set(mid, r);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const ev = (expr) =>
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(
    (r) => r.result?.result?.value
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');

const wyniki = [];
const sprawdz = (n, ok, d = '') => wyniki.push({ n, ok, d });
const dataOf = () => ev('window.__data');

// Połącz i zbieraj dane; automatycznie akceptuj klucz hosta (pierwszy kontakt).
const { connectionId } = await ev(`window.luma.ssh.connect(
  { host: '127.0.0.1', port: ${sshPort}, username: 't', auth: 'password', password: 'x' })`);
await ev(`(() => {
  window.__data = '';
  window.luma.terminal.onData((e) => { window.__data += new TextDecoder().decode(e.data); });
  window.luma.ssh.onHostVerify((r) => window.luma.ssh.respondHostVerify(r.requestId, true));
  window.luma.terminal.create({ kind:'ssh', connectionId:${JSON.stringify(connectionId)}, label:'r' }, 80, 24)
    .catch(e => { window.__err = String(e); });
})()`);

// Czekaj na pierwsze powitanie.
for (let i = 0; i < 50; i += 1) {
  await sleep(150);
  if ((await dataOf())?.includes('POWITANIE-1')) break;
}
sprawdz('połączono, pierwsze powitanie', ((await dataOf()) ?? '').includes('POWITANIE-1'));

// Zerwij aktywne połączenie od strony serwera.
activeClient?.end();

// Transport powinien zauważyć zerwanie i wypisać komunikat o ponawianiu.
for (let i = 0; i < 50; i += 1) {
  await sleep(150);
  if ((await dataOf())?.includes('ponawiam')) break;
}
sprawdz('po zerwaniu: komunikat o ponawianiu', ((await dataOf()) ?? '').includes('ponawiam'));

// Serwer nasłuchuje dalej, więc kolejna próba się powiedzie: „Połączono ponownie" + drugie powitanie.
for (let i = 0; i < 80; i += 1) {
  await sleep(200);
  const d = (await dataOf()) ?? '';
  if (d.includes('Połączono ponownie') && d.includes('POWITANIE-2')) break;
}
const finalData = (await dataOf()) ?? '';
sprawdz('wznowiono połączenie', finalData.includes('Połączono ponownie'));
sprawdz('nowa sesja po wznowieniu (drugie powitanie)', finalData.includes('POWITANIE-2'));

console.log('\nWYNIKI (reconnect SSH)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
server.close();
ws.close();
process.exit(bledy === 0 ? 0 : 1);
