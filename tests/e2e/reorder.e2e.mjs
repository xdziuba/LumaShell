/**
 * Test E2E przeciągania zakładek przez DevTools Protocol.
 * Wymaga aplikacji z --remote-debugging-port=9222.
 *
 * React nasłuchuje zdarzeń na roocie, więc natywny DragEvent z DataTransfer dociera do
 * jego handlerów. Test symuluje pełen ciąg dragstart → dragover → drop.
 */

const base = 'http://127.0.0.1:9222';
// Wyklucz stronę plugin-host (też kończy się index.html) — inaczej trafiamy w okno bez zakładek.
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

// Otwórz Git Bash i CMD z panelu bocznego — trzy zakładki o różnych etykietach.
await ev(`Array.from(document.querySelectorAll('.sidebar__item--action'))
  .find(b => b.textContent.includes('Git Bash'))?.click()`);
await sleep(400);
await ev(`Array.from(document.querySelectorAll('.sidebar__item--action'))
  .find(b => b.textContent.includes('Wiersz polecenia'))?.click()`);
await sleep(500);

const kolejnoscPrzed = await ev(
  `Array.from(document.querySelectorAll('.tabs__label')).map(e => e.textContent.trim())`
);
sprawdz('start: 3 zakładki w kolejności otwarcia', Array.isArray(kolejnoscPrzed) && kolejnoscPrzed.length === 3, JSON.stringify(kolejnoscPrzed));

// Przeciąganie rozłożone na osobne kroki z pauzami — React aktualizuje stan (dragId,
// wskaźnik) asynchronicznie, więc dragstart i dragover muszą trafić w różne rendery,
// tak jak przy prawdziwym ruchu myszy. DataTransfer współdzielony przez window.
await ev(`(() => {
  const items = document.querySelectorAll('.tabs__item');
  window.__dt = new DataTransfer();
  const first = items[0];
  first.dispatchEvent(new DragEvent('dragstart',
    { bubbles: true, cancelable: true, clientX: 0, clientY: 0, dataTransfer: window.__dt }));
})()`);
await sleep(200);
await ev(`(() => {
  const items = document.querySelectorAll('.tabs__item');
  const last = items[items.length - 1];
  const r = last.getBoundingClientRect();
  last.dispatchEvent(new DragEvent('dragover',
    { bubbles: true, cancelable: true, clientX: r.right - 4, clientY: r.top + 8, dataTransfer: window.__dt }));
})()`);
await sleep(200);
await ev(`(() => {
  const items = document.querySelectorAll('.tabs__item');
  const last = items[items.length - 1];
  const r = last.getBoundingClientRect();
  last.dispatchEvent(new DragEvent('drop',
    { bubbles: true, cancelable: true, clientX: r.right - 4, clientY: r.top + 8, dataTransfer: window.__dt }));
})()`);
await sleep(400);

const kolejnoscPo = await ev(
  `Array.from(document.querySelectorAll('.tabs__label')).map(e => e.textContent.trim())`
);
sprawdz('kolejność się zmieniła', JSON.stringify(kolejnoscPo) !== JSON.stringify(kolejnoscPrzed), JSON.stringify(kolejnoscPo));
sprawdz(
  'przeciągnięta zakładka trafiła na koniec',
  Array.isArray(kolejnoscPo) && kolejnoscPo[2] === kolejnoscPrzed[0],
  `${kolejnoscPrzed[0]} → pozycja 3`
);
sprawdz('nadal 3 zakładki (nic nie zniknęło)', Array.isArray(kolejnoscPo) && kolejnoscPo.length === 3);

console.log('\nWYNIKI (przeciąganie zakładek)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
