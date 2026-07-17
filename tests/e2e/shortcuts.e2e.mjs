/**
 * Test E2E palety poleceń i skrótów przez DevTools Protocol.
 *
 * Zdarzenia klawiatury są wstrzykiwane wyłącznie do renderera LumaShell — nic nie
 * trafia do innych okien systemu. Test jest deterministyczny: sprawdza DOM, nie piksele.
 *
 * Wymaga aplikacji uruchomionej z portem debugowania:
 *   npx electron-vite build
 *   ./node_modules/electron/dist/electron.exe . --remote-debugging-port=9222 &
 *   node tests/e2e/shortcuts.e2e.mjs
 */

const base = 'http://127.0.0.1:9222';

async function pageTarget() {
  const res = await fetch(`${base}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) throw new Error('nie znaleziono renderera LumaShell');
  return page.webSocketDebuggerUrl;
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const ready = new Promise((res) => ws.addEventListener('open', res));
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

const evaluate = (c, expression) =>
  c.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r.result?.result?.value);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wysyła keydown bezpośrednio na document renderera — trafia w capture-listener skrótów.
function dispatch(c, { code, key, ctrl = false, shift = false }) {
  return evaluate(
    c,
    `document.dispatchEvent(new KeyboardEvent('keydown', {
       code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)},
       ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true
     })); true`
  );
}

const wyniki = [];
const sprawdz = (nazwa, ok, detal = '') => wyniki.push({ nazwa, ok, detal });

const c = cdp(await pageTarget());
await c.ready;
await c.send('Runtime.enable');

// Stan startowy: jedna zakładka.
sprawdz('start: 1 zakładka', (await evaluate(c, `document.querySelectorAll('.tabs__item').length`)) === 1);

// Ctrl+Shift+P otwiera paletę.
await dispatch(c, { code: 'KeyP', key: 'P', ctrl: true, shift: true });
await sleep(300);
sprawdz('Ctrl+Shift+P otwiera paletę', (await evaluate(c, `!!document.querySelector('.palette')`)) === true);

// Liczba komend na starcie (3 powłoki + 1 port + 4 stałe = 8, ale zależy od maszyny).
const liczbaKomend = await evaluate(c, `document.querySelectorAll('.palette__item').length`);
sprawdz('paleta ma komendy', liczbaKomend > 0, `${liczbaKomend} komend`);

// Escape zamyka paletę.
await evaluate(
  c,
  `document.querySelector('.palette__input').dispatchEvent(
     new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`
);
await sleep(200);
sprawdz('Escape zamyka paletę', (await evaluate(c, `!!document.querySelector('.palette')`)) === false);

// Ctrl+T otwiera nową zakładkę.
await dispatch(c, { code: 'KeyT', key: 't', ctrl: true });
await sleep(400);
const poNowej = await evaluate(c, `document.querySelectorAll('.tabs__item').length`);
sprawdz('Ctrl+T dodaje zakładkę', poNowej === 2, `${poNowej} zakładek`);

// Ctrl+1 aktywuje pierwszą zakładkę.
await dispatch(c, { code: 'Digit1', key: '1', ctrl: true });
await sleep(200);
const pierwszaAktywna = await evaluate(
  c,
  `document.querySelectorAll('.tabs__item')[0].classList.contains('is-active')`
);
sprawdz('Ctrl+1 aktywuje 1. zakładkę', pierwszaAktywna === true);

// Ctrl+Tab przechodzi na następną (drugą).
await dispatch(c, { code: 'Tab', key: 'Tab', ctrl: true });
await sleep(200);
const drugaAktywna = await evaluate(
  c,
  `document.querySelectorAll('.tabs__item')[1].classList.contains('is-active')`
);
sprawdz('Ctrl+Tab → następna zakładka', drugaAktywna === true);

// Ctrl+W zamyka aktywną.
await dispatch(c, { code: 'KeyW', key: 'w', ctrl: true });
await sleep(300);
const poZamknieciu = await evaluate(c, `document.querySelectorAll('.tabs__item').length`);
sprawdz('Ctrl+W zamyka zakładkę', poZamknieciu === 1, `${poZamknieciu} zakładek`);

console.log('\nWYNIKI');
console.log('─'.repeat(52));
for (const w of wyniki) {
  console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.nazwa}${w.detal ? `  (${w.detal})` : ''}`);
}
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
c.close();
process.exit(bledy === 0 ? 0 : 1);
