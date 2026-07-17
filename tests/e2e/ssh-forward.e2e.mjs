/**
 * Test E2E lokalnego przekierowania portu (-L) przez DevTools Protocol.
 *
 * Serwer echo TCP (usługa docelowa) + serwer ssh2 proxujący 'tcpip' do echo. Aplikacja
 * ustawia lokalne przekierowanie; test łączy się z portem lokalnym i sprawdza, że dane
 * wracają echem przez tunel SSH.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

import { generateKeyPairSync } from 'node:crypto';
import { createServer, connect as tcpConnect } from 'node:net';
import ssh2 from 'ssh2';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
});

// Usługa docelowa: echo z prefiksem, żeby potwierdzić przejście przez tunel.
const echo = createServer((socket) => {
  socket.on('data', (d) => socket.write(Buffer.concat([Buffer.from('ECHO:'), d])));
});
const echoPort = await new Promise((r) => echo.listen(0, '127.0.0.1', () => r(echo.address().port)));

// Serwer SSH proxujący 'tcpip' do żądanego celu (tu: echo).
const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
  client.on('error', () => {});
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () => {
    client.on('session', (accept) => {
      const s = accept();
      s.on('pty', (a) => a?.());
      s.on('shell', (a) => a().write('ok\r\n'));
    });
    client.on('tcpip', (accept, _reject, info) => {
      const channel = accept();
      const socket = tcpConnect(info.destPort, info.destIP, () => channel.pipe(socket).pipe(channel));
      socket.on('error', () => channel.end());
    });
  });
});
const sshPort = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

// Wolny lokalny port na przekierowanie.
const localPort = await new Promise((r) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => r(p));
  });
});
console.log(`echo=127.0.0.1:${echoPort}  ssh=127.0.0.1:${sshPort}  local=127.0.0.1:${localPort}`);

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

// Połącz z przekierowaniem localPort → echo.
const { connectionId } = await ev(`window.luma.ssh.connect(${JSON.stringify({
  host: '127.0.0.1',
  port: sshPort,
  username: 'u',
  auth: 'password',
  password: 'x',
  localForwards: [{ localPort, destHost: '127.0.0.1', destPort: echoPort }]
})})`);
await ev(`(() => {
  window.__data = '';
  window.luma.terminal.onData((e) => { window.__data += new TextDecoder().decode(e.data); });
  window.luma.ssh.onHostVerify((r) => window.luma.ssh.respondHostVerify(r.requestId, true));
  window.luma.terminal.create({ kind:'ssh', connectionId:${JSON.stringify(connectionId)}, label:'f' }, 80, 24)
    .catch(e => { window.__err = String(e); });
})()`);

// Poczekaj, aż transport zgłosi ustawione przekierowanie.
for (let i = 0; i < 60; i += 1) {
  await sleep(200);
  if ((await ev('window.__data'))?.includes('Przekierowanie')) break;
}
sprawdz('transport zgłosił przekierowanie', ((await ev('window.__data')) ?? '').includes('Przekierowanie'));

// Połącz się z lokalnym portem i sprawdź echo przez tunel.
const echoBack = await new Promise((resolve) => {
  const socket = tcpConnect(localPort, '127.0.0.1', () => socket.write('ping-przez-tunel'));
  let buf = '';
  socket.on('data', (d) => {
    buf += d.toString();
    socket.end();
    resolve(buf);
  });
  socket.on('error', () => resolve('BLAD-POLACZENIA'));
  setTimeout(() => resolve(buf || 'TIMEOUT'), 5000);
});
sprawdz('dane przeszły przez tunel (echo)', echoBack === 'ECHO:ping-przez-tunel', echoBack);

console.log('\nWYNIKI (local forward)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
echo.close();
server.close();
ws.close();
process.exit(bledy === 0 ? 0 : 1);
