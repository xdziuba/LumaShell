/**
 * Test E2E podziałów paneli przez DevTools Protocol.
 * Wymaga aplikacji z --remote-debugging-port=9222.
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
const dispatch = ({ code, ctrl, shift }) =>
  ev(`document.dispatchEvent(new KeyboardEvent('keydown',
    {code:'${code}', ctrlKey:${!!ctrl}, shiftKey:${!!shift}, bubbles:true, cancelable:true})); true`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');

const wyniki = [];
const sprawdz = (n, ok, d = '') => wyniki.push({ n, ok, d });

// Start: jeden panel w aktywnej zakładce.
sprawdz('start: 1 panel', (await ev(`document.querySelectorAll('.pane-root:not(.pane-root--hidden) .pane').length`)) === 1);

// Ctrl+Shift+E → podział w pionie (row) = 2 panele + 1 granica.
await dispatch({ code: 'KeyE', ctrl: true, shift: true });
await sleep(600);
const poRow = await ev(`document.querySelectorAll('.pane-root:not(.pane-root--hidden) .pane').length`);
sprawdz('Ctrl+Shift+E → 2 panele', poRow === 2, `${poRow} paneli`);
sprawdz('powstała granica pozioma (row)', (await ev(`!!document.querySelector('.split--row > .split__divider')`)) === true);

// Ctrl+Shift+O → podział aktywnego panelu w poziomie = 3 panele.
await dispatch({ code: 'KeyO', ctrl: true, shift: true });
await sleep(600);
const poCol = await ev(`document.querySelectorAll('.pane-root:not(.pane-root--hidden) .pane').length`);
sprawdz('Ctrl+Shift+O → 3 panele (zagnieżdżenie)', poCol === 3, `${poCol} paneli`);
sprawdz('licznik paneli na zakładce', (await ev(`document.querySelector('.tabs__count')?.textContent`)) === '3');

// Dwie żywe powłoki co najmniej — panele mają terminale xterm.
const terminale = await ev(`document.querySelectorAll('.pane-root:not(.pane-root--hidden) .xterm').length`);
sprawdz('każdy panel ma terminal xterm', terminale === 3, `${terminale} xterm`);

// Ctrl+W zamyka aktywny panel → wraca do 2.
await dispatch({ code: 'KeyW', ctrl: true });
await sleep(500);
const poZamk = await ev(`document.querySelectorAll('.pane-root:not(.pane-root--hidden) .pane').length`);
sprawdz('Ctrl+W zamyka panel → 2', poZamk === 2, `${poZamk} paneli`);

// Zakładka wciąż jedna (zamknięcie panelu nie zamknęło zakładki).
sprawdz('zakładka nadal istnieje', (await ev(`document.querySelectorAll('.tabs__item').length`)) === 1);

console.log('\nWYNIKI (podziały)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
