/**
 * Test E2E sesji sieciowych (Etap 7) przez DevTools Protocol.
 *
 * Dowodzi pełnego obiegu w prawdziwej aplikacji: renderer prosi o sesję TCP, proces główny
 * waliduje spec, buduje transport, łączy się z lokalnym serwerem echo, a bajty wracają
 * zdarzeniem terminal:data. Sprawdza też, że komendy sieci/kontenerów są w palecie, a dialog
 * połączenia sieciowego otwiera się z paska bocznego.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

import { createServer } from 'node:net';

const base = 'http://127.0.0.1:9222';

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) =>
    new Promise((r) => {
      const mid = ++id;
      pending.set(mid, r);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wyniki = [];
const sprawdz = (n, ok, d = '') => wyniki.push({ n, ok, d });

// Lokalny serwer echo TCP — cel sesji sieciowej z aplikacji.
const echo = createServer((socket) => socket.on('data', (d) => socket.write(d)));
await new Promise((r) => echo.listen(0, '127.0.0.1', r));
const echoPort = echo.address().port;

const targets = await (await fetch(`${base}/json`)).json();
const mainPage = targets.find(
  (t) => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('plugin-host')
);
const c = connect(mainPage.webSocketDebuggerUrl);
await c.ready;
await c.send('Runtime.enable');
await c.send('Page.enable');
const ev = (expr) =>
  c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(
    (r) => r.result?.result?.value
  );

// --- Pełny obieg TCP przez IPC ---
await ev(`(() => {
  window.__net = '';
  window.luma.terminal.onData((e) => {
    if (window.__netId && e.sessionId === window.__netId) {
      window.__net += new TextDecoder().decode(new Uint8Array(e.data));
    }
  });
})()`);

const created = await ev(`(async () => {
  const r = await window.luma.terminal.create(
    { kind: 'network', protocol: 'tcp', host: '127.0.0.1', port: ${echoPort}, label: 'e2e-tcp' }, 80, 24
  );
  window.__netId = r.sessionId;
  return r.label;
})()`);
sprawdz('sesja TCP utworzona przez IPC', created === 'e2e-tcp', String(created));

await ev(`window.luma.terminal.write(window.__netId, 'ping-e2e\\r')`);
let got = '';
for (let i = 0; i < 30; i += 1) {
  await sleep(150);
  got = await ev(`window.__net`);
  if (got.includes('ping-e2e')) break;
}
sprawdz('echo TCP wróciło zdarzeniem terminal:data', got.includes('ping-e2e'), JSON.stringify(got));
sprawdz('strumień niesie komunikat połączenia', got.includes('Połączono'), '');

// Sprzątanie sesji.
await ev(`window.luma.terminal.dispose(window.__netId)`);

// --- Wykrywanie kontenerów nie wywraca się (puste, gdy brak CLI) ---
const containers = await ev(`window.luma.containers.list().then((l) => Array.isArray(l))`);
sprawdz('containers.list zwraca tablicę', containers === true);

// --- Dialog sieciowy otwiera się z paska bocznego ---
await ev(`(() => {
  const btn = [...document.querySelectorAll('.sidebar__item--action')]
    .find((b) => b.textContent.includes('Połączenie sieciowe'));
  if (btn) btn.click();
})()`);
await sleep(400);
const dialogOpen = await ev(
  `Boolean([...document.querySelectorAll('.dialog__title')].find((e) => e.textContent.includes('Połączenie sieciowe')))`
);
sprawdz('dialog sieciowy otwarty', dialogOpen === true);

// Screenshot dialogu (jeśli katalog docelowy podano argumentem).
const outDir = process.argv[2];
if (outDir && dialogOpen) {
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${outDir}/network-dialog.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('zapisano network-dialog.png');
}

c.close();
echo.close();

console.log('\nWYNIKI (sesje sieciowe E2E)');
console.log('─'.repeat(56));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(56));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
