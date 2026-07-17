/**
 * Test E2E profili połączeń przez DevTools Protocol.
 *
 * Steruje wyłącznie rendererem LumaShell (klik w DOM), nic nie trafia do innych okien.
 *
 * Wymaga aplikacji z portem debugowania:
 *   ./node_modules/electron/dist/electron.exe . --remote-debugging-port=9222 &
 *   node tests/e2e/profiles.e2e.mjs
 */

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
const sprawdz = (nazwa, ok, detal = '') => wyniki.push({ nazwa, ok, detal });

// Stan startowy.
sprawdz('start: brak profili', (await ev(`document.querySelectorAll('.sidebar__profile').length`)) === 0);

// Zapisz aktywną sesję jako profil (klik w „+" przy nagłówku PROFILE).
await ev(`document.querySelector('.sidebar__heading-action').click(); true`);
await sleep(400);
const poZapisie = await ev(`document.querySelectorAll('.sidebar__profile').length`);
sprawdz('zapis tworzy profil', poZapisie === 1, `${poZapisie} profili`);

// Profil trwały: preload zwraca listę z procesu głównego, czyli z dysku.
const zListy = await ev(`window.luma.profiles.list().then(p => p.length)`);
sprawdz('profil zapisany po stronie main', zListy === 1, `${zListy} w store`);

const nazwa = await ev(`document.querySelector('.sidebar__profile-open').textContent.trim()`);
sprawdz('profil ma nazwę aktywnej zakładki', typeof nazwa === 'string' && nazwa.length > 1, nazwa);

// Otwórz z profilu — powinna dojść druga zakładka.
const przed = await ev(`document.querySelectorAll('.tabs__item').length`);
await ev(`document.querySelector('.sidebar__profile-open').click(); true`);
await sleep(500);
const po = await ev(`document.querySelectorAll('.tabs__item').length`);
sprawdz('otwarcie profilu dodaje zakładkę', po === przed + 1, `${przed} → ${po}`);

// Usuń profil.
await ev(`document.querySelector('.sidebar__profile-del').click(); true`);
await sleep(400);
const poUsun = await ev(`document.querySelectorAll('.sidebar__profile').length`);
sprawdz('usunięcie kasuje profil z UI', poUsun === 0, `${poUsun} profili`);
const wStore = await ev(`window.luma.profiles.list().then(p => p.length)`);
sprawdz('usunięcie kasuje profil w store', wStore === 0, `${wStore} w store`);

console.log('\nWYNIKI');
console.log('─'.repeat(56));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.nazwa}${w.detal ? `  (${w.detal})` : ''}`);
console.log('─'.repeat(56));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
