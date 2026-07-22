/**
 * Test E2E widoków wtyczek (Plugin API v2): drzewo jako zakładka.
 *
 * Sprawdza pełny łańcuch, którego wcześniej nie było w ogóle — wtyczka nie mogła narysować
 * niczego w interfejsie:
 *   wtyczka (proces Node) → RPC → bramka uprawnień → IPC → zakładka rysowana przez aplikację
 * a w drugą stronę: dwuklik w drzewie → komenda wtyczki → prośba o terminal → nowa sesja.
 *
 * Wtyczką testową jest File Explorer, bo czyta prawdziwy katalog domowy przez `node:fs`.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

const ID = 'com.lumashell.file-explorer';
const WIDOK = 'pliki';
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

// Gotowość IPC wtyczek (ładowane po pokazaniu okna).
for (let i = 0; i < 60; i += 1) {
  const gotowe = await ev(
    `window.luma.plugins.installed().then(l => l.some(p => p.id === ${JSON.stringify(ID)})).catch(() => false)`
  );
  if (gotowe) break;
  await sleep(500);
}

// Wtyczka jest z pełnym dostępem, więc bez zgody nie ma widoku — to też sprawdzamy.
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, false)`);
await sleep(1000);
let widoki = await ev('window.luma.plugins.views()');
sprawdz(
  'wyłączona wtyczka nie wystawia widoku',
  Array.isArray(widoki) && !widoki.some((v) => v.pluginId === ID),
  JSON.stringify(widoki)
);

await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, true)`);
for (let i = 0; i < 40; i += 1) {
  await sleep(300);
  widoki = await ev('window.luma.plugins.views()');
  if (Array.isArray(widoki) && widoki.some((v) => v.pluginId === ID)) break;
}
const widok = Array.isArray(widoki) ? widoki.find((v) => v.pluginId === ID) : undefined;
sprawdz('włączona wtyczka zgłasza widok', Boolean(widok), JSON.stringify(widoki));
sprawdz('widok niesie nazwę wtyczki', widok?.pluginName === 'File Explorer', widok?.pluginName);

// Zawartość drzewa idzie prosto z procesu wtyczki (node:fs).
const korzen = await ev(`window.luma.plugins.viewChildren(${JSON.stringify(ID)}, ${JSON.stringify(WIDOK)}, null)`);
sprawdz('drzewo ma zawartość', Array.isArray(korzen) && korzen.length > 0, `pozycji: ${korzen?.length}`);
const katalog = Array.isArray(korzen) ? korzen.find((n) => n.expandable) : undefined;
sprawdz('są katalogi do rozwinięcia', Boolean(katalog), katalog?.label);

// Leniwe wczytanie: dzieci pobierane dopiero na żądanie.
if (katalog) {
  const dzieci = await ev(
    `window.luma.plugins.viewChildren(${JSON.stringify(ID)}, ${JSON.stringify(WIDOK)}, ${JSON.stringify(katalog.id)})`
  );
  sprawdz('dzieci węzła wczytywane osobno', Array.isArray(dzieci), `pozycji: ${dzieci?.length}`);
}

// Widok otwierany jako ZAKŁADKA z palety komend.
await ev(`(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'P', code:'KeyP', ctrlKey:true, shiftKey:true, bubbles:true }));
})()`);
await sleep(500);
await ev(`(() => {
  const i = document.querySelector('.palette__input');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'Pliki');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(400);
await ev(`(() => {
  const w = [...document.querySelectorAll('.palette__item')].find(e => e.textContent.includes('File Explorer'));
  w?.click();
})()`);
await sleep(1500);

const stan = await ev(`(() => ({
  zakladki: [...document.querySelectorAll('.tabs__item .tabs__label')].map(e => e.textContent),
  tytul: document.querySelector('.titlebar__title')?.textContent,
  wiersze: document.querySelectorAll('.ptree__row').length
}))()`);
sprawdz('widok otwarty jako zakładka', stan?.zakladki?.includes('Pliki'), JSON.stringify(stan?.zakladki));
sprawdz('pasek tytułu pokazuje nazwę widoku', stan?.tytul === 'Pliki', stan?.tytul);
sprawdz('drzewo wyrenderowane przez aplikację', (stan?.wiersze ?? 0) > 0, `wierszy: ${stan?.wiersze}`);

// Rozwijanie klikiem — dzieci dochodzą do listy.
const poKliku = await ev(`(async () => {
  const wiersz = [...document.querySelectorAll('.ptree__row')].find(r => r.querySelector('.ptree__arrow')?.textContent === '▸');
  const przed = document.querySelectorAll('.ptree__row').length;
  wiersz?.click();
  await new Promise(r => setTimeout(r, 1500));
  return { przed, po: document.querySelectorAll('.ptree__row').length,
           strzalka: wiersz?.querySelector('.ptree__arrow')?.textContent };
})()`);
sprawdz('klik rozwija węzeł', (poKliku?.po ?? 0) > (poKliku?.przed ?? 0), `${poKliku?.przed} → ${poKliku?.po}`);
sprawdz('strzałka pokazuje rozwinięcie', poKliku?.strzalka === '▾', poKliku?.strzalka);

// Dwuklik na katalogu → komenda wtyczki → terminal w tym katalogu.
const term = await ev(`(async () => {
  const przed = document.querySelectorAll('.tabs__item').length;
  const wiersz = [...document.querySelectorAll('.ptree__row')].find(r => r.querySelector('.ptree__arrow')?.textContent);
  const nazwa = wiersz?.querySelector('.ptree__label')?.textContent;
  wiersz?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await new Promise(r => setTimeout(r, 3000));
  return { nazwa, przed, po: document.querySelectorAll('.tabs__item').length,
           etykiety: [...document.querySelectorAll('.tabs__item .tabs__label')].map(e => e.textContent) };
})()`);
sprawdz('dwuklik otwiera terminal w katalogu', (term?.po ?? 0) > (term?.przed ?? 0), JSON.stringify(term?.etykiety));
sprawdz(
  'nowa zakładka wskazuje ten katalog',
  Boolean(term?.nazwa) && term.etykiety.some((e) => e.includes(term.nazwa)),
  `${term?.nazwa} w ${JSON.stringify(term?.etykiety)}`
);

// Wyłączenie wtyczki zabiera widok — zakładka musi to powiedzieć, a nie udawać, że działa.
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, false)`);
await sleep(1500);
const poWylaczeniu = await ev(`(() => ({
  widoki: 0,
  komunikat: document.querySelector('.panel__hint')?.textContent ?? ''
}))()`);
widoki = await ev('window.luma.plugins.views()');
sprawdz('wyłączenie zdejmuje widok z listy', !widoki.some((v) => v.pluginId === ID), JSON.stringify(widoki));
sprawdz(
  'otwarta zakładka mówi, że widok jest niedostępny',
  poWylaczeniu?.komunikat.includes('niedostępny'),
  poWylaczeniu?.komunikat
);

console.log('\nWYNIKI (widoki wtyczek)');
console.log('─'.repeat(60));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(60));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
