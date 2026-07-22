/**
 * Test E2E dostępu wtyczek do terminala i bramki narzędzi AI (Plugin API v2).
 *
 * Dwie rzeczy, które do tej pory były DEKLARACJĄ BEZ POKRYCIA:
 *  - uprawnienia `terminal.read` i `terminal.write` istniały w manifeście, ale nie było
 *    żadnego API, którego by dotyczyły,
 *  - narzędzia wtyczek trafiały do modelu automatycznie, razem z włączeniem wtyczki.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

const SONDA = 'com.lumashell.probe-node';
const TOOLBOX = 'com.lumashell.toolbox';
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

for (let i = 0; i < 60; i += 1) {
  const gotowe = await ev(
    `window.luma.plugins.installed().then(l => l.some(p => p.id === ${JSON.stringify(SONDA)})).catch(() => false)`
  );
  if (gotowe) break;
  await sleep(500);
}

// --- narzędzia AI: osobna zgoda, domyślnie brak ---
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(TOOLBOX)}, true)`);
await sleep(800);
await ev(`window.luma.plugins.setAiTools(${JSON.stringify(TOOLBOX)}, false)`);
await sleep(600);

let narzedzia = await ev('window.luma.plugins.listTools()');
sprawdz(
  'wtyczka z ai.tools NIE jest widoczna dla modelu bez zgody',
  Array.isArray(narzedzia) && !narzedzia.some((t) => t.pluginId === TOOLBOX),
  JSON.stringify(narzedzia?.map((t) => t.id))
);

await ev(`window.luma.plugins.setAiTools(${JSON.stringify(TOOLBOX)}, true)`);
await sleep(600);
narzedzia = await ev('window.luma.plugins.listTools()');
sprawdz(
  'po zgodzie narzędzie pojawia się w zestawie modelu',
  Array.isArray(narzedzia) && narzedzia.some((t) => t.pluginId === TOOLBOX),
  JSON.stringify(narzedzia?.map((t) => t.id))
);

await ev(`window.luma.plugins.setAiTools(${JSON.stringify(TOOLBOX)}, false)`);
await sleep(600);
narzedzia = await ev('window.luma.plugins.listTools()');
sprawdz(
  'cofnięcie zgody znów ukrywa narzędzie',
  Array.isArray(narzedzia) && !narzedzia.some((t) => t.pluginId === TOOLBOX),
  JSON.stringify(narzedzia?.map((t) => t.id))
);

// Zgoda przeżywa restart, więc sprzątamy po sobie także stan wtyczki testowej.
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(TOOLBOX)}, false)`);

// --- dostęp wtyczki do terminala ---
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(SONDA)}, true)`);
for (let i = 0; i < 40; i += 1) {
  await sleep(300);
  const p = await ev(
    `window.luma.plugins.installed().then(l => l.find(x => x.id === ${JSON.stringify(SONDA)}))`
  );
  if (p?.proces?.stan === 'dziala') break;
}

// Do terminala musi coś trafić, żeby było co czytać.
await ev(`(async () => {
  const sesje = await window.luma.plugins.commands();
  return sesje.length;
})()`);
await sleep(500);

// Komenda wtyczki: lista sesji (uprawnienie terminal.read).
const notif = async (commandId) => {
  await ev(`(() => { window.__n = null; window.luma.plugins.onNotification((n) => { window.__n = n; }); })()`);
  await ev(`window.luma.plugins.runCommand(${JSON.stringify(SONDA)}, ${JSON.stringify(commandId)})`);
  for (let i = 0; i < 25; i += 1) {
    await sleep(200);
    const n = await ev('window.__n');
    if (n) return n;
  }
  return null;
};

const sesje = await notif('probe.terminals');
sprawdz(
  'wtyczka widzi sesje terminala',
  Boolean(sesje) && /Sesje:/.test(String(sesje.message)),
  String(sesje?.message)
);

const odczyt = await notif('probe.read');
sprawdz(
  'wtyczka czyta ostatnie wiersze sesji',
  Boolean(odczyt) && /Odczytano \d+ wierszy/.test(String(odczyt.message)),
  String(odczyt?.message)
);

await ev(`window.luma.plugins.setEnabled(${JSON.stringify(SONDA)}, false)`);

console.log('\nWYNIKI (terminal dla wtyczek + bramka AI)');
console.log('─'.repeat(60));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(60));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
