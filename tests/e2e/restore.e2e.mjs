/**
 * Test E2E przywracania sesji przez DevTools Protocol.
 *
 * Wymaga dwóch uruchomień aplikacji (skrypt steruje jednym połączeniem naraz):
 *   faza 1 — otwórz dodatkowe zakładki, poczekaj na zapis workspace'u
 *   faza 2 — po restarcie sprawdź, że zakładki powłok wróciły, a port COM nie
 *
 * Uruchomienie fazy przez argument: node restore.e2e.mjs setup | node restore.e2e.mjs verify
 */

const faza = process.argv[2];
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

if (faza === 'setup') {
  // Otwórz drugą powłokę (Git Bash) i port COM1, żeby sprawdzić oba przypadki.
  await ev(`Array.from(document.querySelectorAll('.sidebar__item--action'))
    .find(b => b.textContent.includes('Git Bash'))?.click()`);
  await sleep(500);
  await ev(`Array.from(document.querySelectorAll('.sidebar__item--action'))
    .find(b => b.textContent.trim().startsWith('+ COM'))?.click()`);
  await sleep(800);
  const zakladki = await ev(`document.querySelectorAll('.tabs__item').length`);
  console.log(`FAZA 1: otwarto zakładki, jest ${zakladki}`);
  // Odczekaj na zapis (debounce 500 ms) z zapasem.
  await sleep(1200);
  console.log('workspace zapisany');
  ws.close();
  process.exit(0);
}

if (faza === 'verify') {
  const etykiety = await ev(
    `Array.from(document.querySelectorAll('.tabs__label')).map(e => e.textContent.trim())`
  );
  const wyniki = [];
  const sprawdz = (n, ok, d = '') => wyniki.push({ n, ok, d });

  sprawdz('są przywrócone zakładki', Array.isArray(etykiety) && etykiety.length >= 2, JSON.stringify(etykiety));
  sprawdz('powłoka lokalna przywrócona', etykiety.some((e) => /PowerShell|Bash|polecenia/i.test(e)));
  sprawdz(
    'port COM NIE przywrócony',
    !etykiety.some((e) => /^COM\d/i.test(e)),
    'porty szeregowe celowo pomijane'
  );

  console.log('\nWYNIKI (po restarcie)');
  console.log('─'.repeat(52));
  for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
  console.log('─'.repeat(52));
  const bledy = wyniki.filter((w) => !w.ok).length;
  console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
  ws.close();
  process.exit(bledy === 0 ? 0 : 1);
}

console.error('podaj fazę: setup | verify');
process.exit(2);
