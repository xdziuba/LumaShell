/**
 * Test E2E systemu wtyczek (Etap 6) przez DevTools Protocol.
 *
 * Sprawdza pełny obieg przez izolowany Plugin Host oraz — kluczowe dla decyzji D2 —
 * że host NIE ma dostępu do Node (require/process/module niedostępne).
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

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

// --- Renderer główny: komenda wtyczki + powiadomienie ---
const targets = await (await fetch(`${base}/json`)).json();
const mainPage = targets.find((t) => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('plugin-host'));
const c = connect(mainPage.webSocketDebuggerUrl);
await c.ready;
await c.send('Runtime.enable');
const ev = (expr) =>
  c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(
    (r) => r.result?.result?.value
  );

// Poczekaj, aż wtyczka się załaduje i zgłosi komendę.
let cmds = [];
for (let i = 0; i < 40; i += 1) {
  await sleep(200);
  cmds = (await ev(`window.luma.plugins.commands()`)) ?? [];
  if (cmds.length > 0) break;
}
sprawdz('wtyczka zgłosiła komendę', cmds.some((x) => x.id === 'hello.sayHello'), JSON.stringify(cmds));

// Uruchom komendę i sprawdź, że przyszło powiadomienie (RPC przez izolowany host).
await ev(`(() => {
  window.__notif = null;
  window.luma.plugins.onNotification((n) => { window.__notif = n; });
  window.luma.plugins.runCommand('com.lumashell.hello', 'hello.sayHello');
})()`);
let notif = null;
for (let i = 0; i < 30; i += 1) {
  await sleep(150);
  notif = await ev(`window.__notif`);
  if (notif) break;
}
sprawdz('komenda wywołała powiadomienie od wtyczki', notif != null && String(notif.message).includes('Izolacja D2'), JSON.stringify(notif));
sprawdz('powiadomienie ma nazwę wtyczki', notif?.pluginName === 'Hello', notif?.pluginName);
c.close();

// --- Plugin Host: dowód izolacji (brak Node) ---
const hostTarget = targets.find((t) => t.url.includes('plugin-host'));
sprawdz('okno Plugin Hosta istnieje', Boolean(hostTarget), hostTarget?.url);
if (hostTarget) {
  const h = connect(hostTarget.webSocketDebuggerUrl);
  await h.ready;
  await h.send('Runtime.enable');
  const hev = (expr) =>
    h.send('Runtime.evaluate', { expression: expr, returnByValue: true }).then((r) => r.result?.result?.value);

  sprawdz('host: require niedostępne', (await hev(`typeof require`)) === 'undefined');
  sprawdz('host: module niedostępne', (await hev(`typeof module`)) === 'undefined');
  sprawdz('host: process niedostępne', (await hev(`typeof process`)) === 'undefined');
  // Most RPC jest jedynym oknem na świat.
  sprawdz('host: most pluginHost dostępny', (await hev(`typeof window.pluginHost`)) === 'object');
  h.close();
}

console.log('\nWYNIKI (system wtyczek)');
console.log('─'.repeat(56));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(56));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
