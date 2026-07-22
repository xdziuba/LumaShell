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

  // --- Brak sieci: egzekwowany na SESJI, nie przez CSP ---
  //
  // CSP dokumentu blokuje fetch w samym dokumencie, ale NIE obejmuje Web Workerów: worker
  // utworzony na stronie file:// wychodzi do sieci mimo `default-src 'none'`. Dlatego host
  // ma własną sesję z `webRequest` anulującym wszystko poza plikami aplikacji. Serwer stoi
  // lokalnie, więc test nie zależy od internetu.
  const { createServer } = await import('node:http');
  const srv = createServer((_req, res) => res.end('SIEC-DZIALA'));
  const port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const cel = `http://127.0.0.1:${port}/sonda`;

  const hevAsync = (expr) =>
    h.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(
      (r) => r.result?.result?.value
    );

  const zDokumentu = await hevAsync(
    `fetch(${JSON.stringify(cel)}).then(r => r.text()).catch(e => 'ZABLOKOWANE')`
  );
  sprawdz('host: fetch z dokumentu zablokowany', zDokumentu === 'ZABLOKOWANE', String(zDokumentu));

  const zWorkera = await hevAsync(`(() => new Promise((resolve) => {
    const kod = 'self.onmessage = () => { fetch(' + ${JSON.stringify(JSON.stringify(cel))} + ')' +
      '.then(r => r.text()).then(t => self.postMessage(t)).catch(() => self.postMessage("ZABLOKOWANE")); };';
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([kod], { type: 'text/javascript' }))); }
    catch (e) { resolve('WORKER NIEDOSTEPNY'); return; }
    const t = setTimeout(() => resolve('BRAK ODPOWIEDZI'), 5000);
    w.onmessage = (ev) => { clearTimeout(t); resolve(ev.data); };
    w.onerror = () => { clearTimeout(t); resolve('BLAD WORKERA'); };
    w.postMessage(1);
  }))()`);
  // Uwaga na interpretację: dziś CSP hosta nie pozwala nawet UTWORZYĆ workera (brak
  // `worker-src`), więc ten przypadek kończy się błędem workera. Asercja mówi więc tyle,
  // ile faktycznie sprawdza: tą drogą sieć nie wychodzi. Że anuluje ją także blokada sesji,
  // zweryfikowano osobno na hoście z luźniejszym CSP — patrz komentarz w plugin-host.ts.
  sprawdz('host: sieć nie wychodzi z Web Workera', zWorkera !== 'SIEC-DZIALA', String(zWorkera));

  srv.close();
  h.close();
}

console.log('\nWYNIKI (system wtyczek)');
console.log('─'.repeat(56));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(56));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
