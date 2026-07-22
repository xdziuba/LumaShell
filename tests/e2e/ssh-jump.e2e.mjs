/**
 * Test E2E jump hosta (bastion) przez DevTools Protocol.
 *
 * Dwa serwery ssh2 w procesie testu: docelowy (powłoka z powitaniem) i bastion, który na
 * żądanie 'tcpip' proxuje kanał do celu. Aplikacja łączy się z celem PRZEZ bastion.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

import { generateKeyPairSync } from 'node:crypto';
import { connect as tcpConnect } from 'node:net';
import ssh2 from 'ssh2';

function key() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  }).privateKey;
}

// Serwer docelowy: zwykła powłoka z powitaniem.
const target = new ssh2.Server({ hostKeys: [key()] }, (client) => {
  client.on('error', () => {});
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () =>
    client.on('session', (accept) => {
      const s = accept();
      s.on('pty', (a) => a?.());
      s.on('shell', (a) => a().write('POWITANIE-Z-CELU\r\n'));
    })
  );
});
const targetPort = await new Promise((r) => target.listen(0, '127.0.0.1', () => r(target.address().port)));

// Bastion: na żądanie tcpip proxuje strumień do celu (127.0.0.1:targetPort).
let jumpSawTcpip = false;
const jump = new ssh2.Server({ hostKeys: [key()] }, (client) => {
  client.on('error', () => {});
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () => {
    client.on('tcpip', (accept, _reject, info) => {
      jumpSawTcpip = true;
      const channel = accept();
      const socket = tcpConnect(info.destPort, info.destIP, () => {
        channel.pipe(socket).pipe(channel);
      });
      socket.on('error', () => channel.end());
    });
  });
});
const jumpPort = await new Promise((r) => jump.listen(0, '127.0.0.1', () => r(jump.address().port)));
console.log(`cel=127.0.0.1:${targetPort}  bastion=127.0.0.1:${jumpPort}`);

const base = 'http://127.0.0.1:9222';
const page = (await (await fetch(`${base}/json`)).json()).find(
  (t) => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('plugin-host')
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

// Połącz przez bastion, akceptuj oba klucze hosta.
const { connectionId } = await ev(`window.luma.ssh.connect(${JSON.stringify({
  host: '127.0.0.1',
  port: targetPort,
  username: 'u',
  auth: 'password',
  password: 'x',
  jump: { host: '127.0.0.1', port: jumpPort, username: 'j', auth: 'password', password: 'x' }
})})`);
await ev(`(() => {
  window.__data = '';
  window.luma.terminal.onData((e) => { window.__data += new TextDecoder().decode(e.data); });
  window.luma.ssh.onHostVerify((r) => window.luma.ssh.respondHostVerify(r.requestId, true));
  window.luma.terminal.create({ kind:'ssh', connectionId:${JSON.stringify(connectionId)}, label:'j' }, 80, 24)
    .catch(e => { window.__err = String(e); });
})()`);

let data = '';
for (let i = 0; i < 80; i += 1) {
  await sleep(200);
  data = (await ev('window.__data')) ?? '';
  if (data.includes('POWITANIE-Z-CELU')) break;
}
sprawdz('bastion obsłużył żądanie tcpip', jumpSawTcpip);
sprawdz('powitanie z CELU dotarło przez bastion', data.includes('POWITANIE-Z-CELU'), `${data.length} B`);

console.log('\nWYNIKI (jump host)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
target.close();
jump.close();
ws.close();
process.exit(bledy === 0 ? 0 : 1);
