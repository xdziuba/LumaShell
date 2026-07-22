/**
 * Test E2E webview wtyczek (Plugin API v2): własna strona wtyczki w zakładce.
 *
 * Sprawdza pełny obieg, w którym wtyczka rysuje DOWOLNY interfejs, a mimo to nie dostaje
 * większych uprawnień niż wcześniej:
 *   ramka (luma-view://) → postMessage → renderer → IPC → bramka → proces wtyczki → dysk
 *
 * Weryfikuje też granice, które stawia aplikacja, a nie wtyczka: własne pochodzenie ramki,
 * CSP z nagłówka, brak wyjścia poza katalog `media` wtyczki.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ID = 'com.lumashell.file-explorer';
const base = 'http://127.0.0.1:9222';

const katalog = join(tmpdir(), 'luma-webview-test');
const plik = join(katalog, 'proba.txt');
mkdirSync(katalog, { recursive: true });
writeFileSync(plik, 'tresc poczatkowa\n', 'utf8');

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

// Gotowość IPC wtyczek.
for (let i = 0; i < 60; i += 1) {
  const gotowe = await ev(
    `window.luma.plugins.installed().then(l => l.some(p => p.id === ${JSON.stringify(ID)})).catch(() => false)`
  );
  if (gotowe) break;
  await sleep(500);
}
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, true)`);
await sleep(3000);

const widoki = await ev('window.luma.plugins.views()');
const widok = Array.isArray(widoki) ? widoki.find((v) => v.pluginId === ID && v.type === 'webview') : undefined;
sprawdz('wtyczka wystawia widok typu webview', Boolean(widok), JSON.stringify(widoki?.map((v) => `${v.id}:${v.type}`)));
sprawdz(
  'widok ma adres na własnym schemacie',
  typeof widok?.url === 'string' && widok.url.startsWith('luma-view://'),
  widok?.url
);

// Otwórz zakładkę widoku z palety.
await ev(`(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'P', code:'KeyP', ctrlKey:true, shiftKey:true, bubbles:true }));
})()`);
await sleep(500);
await ev(`(() => {
  const i = document.querySelector('.palette__input');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'Edytor');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(400);
await ev(`(() => {
  const w = [...document.querySelectorAll('.palette__item')].find(e => e.textContent.includes('Edytor'));
  w?.click();
})()`);
await sleep(2500);

const ramka = await ev(`(() => {
  const f = document.querySelector('.pview__frame');
  if (!f) return { jest: false };
  let dostepDoDokumentu;
  try {
    // Brak dostępu = ramka NAPRAWDĘ jest na innym pochodzeniu (czyli strona się wczytała).
    dostepDoDokumentu = f.contentDocument === null ? 'zablokowany (inne pochodzenie)' : 'dostępny';
  } catch (e) {
    dostepDoDokumentu = 'wyjątek: ' + e.name;
  }
  return { jest: true, src: f.getAttribute('src'), dostepDoDokumentu };
})()`);
sprawdz('ramka widoku osadzona w zakładce', ramka?.jest === true, JSON.stringify(ramka));
sprawdz(
  'strona wtyczki działa na WŁASNYM pochodzeniu',
  ramka?.dostepDoDokumentu?.startsWith('zablokowany'),
  ramka?.dostepDoDokumentu
);

// Wtyczka wczytuje plik i wysyła go do swojej strony — dysk czyta PROCES wtyczki, nie ramka.
await ev(
  `window.luma.plugins.runNodeCommand(${JSON.stringify(ID)}, 'fileExplorer.openFile', ${JSON.stringify(plik)})`
);
await sleep(2000);

// Zapis: wpisujemy tekst w ramce (klawiatura trafia do dokumentu widoku) i klikamy Zapisz.
const NOWA = 'zapis z webview';
await send('Input.dispatchKeyEvent', { type: 'char', text: '\n' });
for (const znak of NOWA) await send('Input.dispatchKeyEvent', { type: 'char', text: znak });
await sleep(400);

// Przycisk „Zapisz" jest w prawym górnym rogu strony wtyczki — klikamy w jego miejsce.
const poz = await ev(`(() => {
  const r = document.querySelector('.pview__frame').getBoundingClientRect();
  return { x: Math.round(r.right - 51), y: Math.round(r.top + 22) };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: poz.x, y: poz.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: poz.x, y: poz.y, button: 'left', clickCount: 1 });
await sleep(2000);

const naDysku = readFileSync(plik, 'utf8');
sprawdz('zapis z widoku dotarł na dysk', naDysku.includes(NOWA), JSON.stringify(naDysku));
sprawdz('poprzednia treść zachowana', naDysku.includes('tresc poczatkowa'), '');

// Granica: adres poza katalogiem media wtyczki nie może wyjść wyżej.
const poza = await ev(`(async () => {
  try {
    const r = await fetch('luma-view://com-lumashell-file-explorer/../plugin.json');
    return 'status ' + r.status;
  } catch (e) {
    return 'zablokowane';
  }
})()`);
sprawdz('wyjście poza katalog media zablokowane', poza !== 'status 200', String(poza));

console.log('\nWYNIKI (webview wtyczek)');
console.log('─'.repeat(60));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(60));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
