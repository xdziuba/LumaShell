/**
 * Test akceptacyjny wtyczki Discord Rich Presence (Plugin API v2).
 *
 * To jest dowód, że nowy runtime wystarcza do realnej integracji: wtyczka otwiera nazwany
 * potok, mówi protokołem Discorda i bierze z aplikacji kontekst (nazwa, wersja, czas sesji,
 * aktywna zakładka) — a aplikacja nie ma ani jednej linii API „do gniazd".
 *
 * Zamiast prawdziwego Discorda stawiamy WŁASNY serwer na `\\.\pipe\discord-ipc-0` i
 * sprawdzamy ramki co do bajtu. Dzięki temu test jest powtarzalny i nie wymaga niczego
 * zainstalowanego. Jeśli potok jest zajęty (Discord naprawdę działa), test to mówi i kończy
 * się bez wyniku, zamiast udawać, że sprawdził.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ID = 'com.lumashell.discord-rpc';
const CLIENT_ID = '000000000000000001';
const POTOK = process.platform === 'win32' ? '\\\\.\\pipe\\discord-ipc-0' : `${process.env.TMPDIR ?? '/tmp'}/discord-ipc-0`;

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

const wyniki = [];
const sprawdz = (n, ok, d = '') => wyniki.push({ n, ok, d });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ramka(op, dane) {
  const tresc = Buffer.from(JSON.stringify(dane), 'utf8');
  const naglowek = Buffer.alloc(8);
  naglowek.writeInt32LE(op, 0);
  naglowek.writeInt32LE(tresc.length, 4);
  return Buffer.concat([naglowek, tresc]);
}

// --- udawany Discord ------------------------------------------------------------------

const odebrane = [];
let klient = null;

const serwer = createServer((socket) => {
  klient = socket;
  let bufor = Buffer.alloc(0);
  socket.on('data', (porcja) => {
    bufor = Buffer.concat([bufor, porcja]);
    for (;;) {
      if (bufor.length < 8) break;
      const op = bufor.readInt32LE(0);
      const dlugosc = bufor.readInt32LE(4);
      if (bufor.length < 8 + dlugosc) break;
      const dane = JSON.parse(bufor.subarray(8, 8 + dlugosc).toString('utf8'));
      bufor = bufor.subarray(8 + dlugosc);
      odebrane.push({ op, dane });

      // Odpowiadamy jak Discord: po uzgodnieniu przychodzi READY.
      if (op === OP.HANDSHAKE) {
        socket.write(ramka(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1, user: { username: 'tester' } } }));
      }
    }
  });
  socket.on('error', () => {});
});

const zajety = await new Promise((resolve) => {
  serwer.once('error', (e) => resolve(e.code ?? 'BŁĄD'));
  serwer.listen(POTOK, () => resolve(null));
});

if (zajety) {
  console.log(`Potok ${POTOK} jest zajęty (${zajety}) — prawdopodobnie działa prawdziwy Discord.`);
  console.log('Zamknij Discorda i uruchom test ponownie; nie udaję, że sprawdziłem.');
  process.exit(2);
}
console.log(`Udawany Discord nasłuchuje na ${POTOK}`);

// --- CDP ------------------------------------------------------------------------------

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
await send('Runtime.enable');

// Czekamy na gotowość IPC wtyczek (ładowane po pokazaniu okna).
for (let i = 0; i < 60; i += 1) {
  const gotowe = await ev(
    `window.luma.plugins.installed().then(l => l.some(p => p.id === ${JSON.stringify(ID)})).catch(() => false)`
  );
  if (gotowe) break;
  await sleep(500);
}

// Client ID trafia do magazynu wtyczki PRZED startem — wtyczka czyta go w activate().
const sciezki = await ev('window.luma.paths.get()');
mkdirSync(sciezki.pluginsData, { recursive: true });
writeFileSync(join(sciezki.pluginsData, `${ID}.json`), JSON.stringify({ clientId: CLIENT_ID }, null, 2), 'utf8');

// Włącz (albo przeładuj, jeśli już włączona) — activate() ma zobaczyć nowy clientId.
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, false)`);
await sleep(800);
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, true)`);

const czekajNa = async (predykat, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const trafienie = odebrane.find(predykat);
    if (trafienie) return trafienie;
    if (Date.now() - t0 > ms) return null;
    await sleep(200);
  }
};

// --- asercje --------------------------------------------------------------------------

const handshake = await czekajNa((r) => r.op === OP.HANDSHAKE);
sprawdz('wtyczka nawiązała uzgodnienie', Boolean(handshake), JSON.stringify(handshake?.dane));
sprawdz('uzgodnienie niesie wersję 1', handshake?.dane?.v === 1, String(handshake?.dane?.v));
sprawdz('uzgodnienie niesie nasz client_id', handshake?.dane?.client_id === CLIENT_ID, String(handshake?.dane?.client_id));

const status = await czekajNa((r) => r.op === OP.FRAME && r.dane?.cmd === 'SET_ACTIVITY');
sprawdz('wtyczka ustawiła aktywność', Boolean(status), JSON.stringify(status?.dane).slice(0, 200));

const aktywnosc = status?.dane?.args?.activity;
sprawdz('aktywność opisuje LumaShell', aktywnosc?.details === 'LumaShell', String(aktywnosc?.details));
sprawdz('aktywność ma nazwę zakładki', typeof aktywnosc?.state === 'string' && aktywnosc.state.length > 0, String(aktywnosc?.state));
sprawdz(
  'aktywność niesie czas startu sesji',
  typeof aktywnosc?.timestamps?.start === 'number' && aktywnosc.timestamps.start > 1_600_000_000_000,
  String(aktywnosc?.timestamps?.start)
);
sprawdz('aktywność prosi o logo aplikacji', aktywnosc?.assets?.large_image === 'lumashell', String(aktywnosc?.assets?.large_image));
sprawdz('ramka niesie PID procesu wtyczki', typeof status?.dane?.args?.pid === 'number', String(status?.dane?.args?.pid));

// Zmiana aktywnej zakładki musi trafić do Discorda (przez zdarzenie z aplikacji do wtyczki).
const przedZmiana = odebrane.filter((r) => r.dane?.cmd === 'SET_ACTIVITY').length;
await ev(`(() => {
  const b = [...document.querySelectorAll('.statusbar__menus button')].find(x => x.textContent.trim().startsWith('Widok'));
  b?.click();
})()`);
await sleep(400);
await ev(`(() => {
  const b = [...document.querySelectorAll('.dropup__item')].find(x => x.textContent.includes('Ustawienia'));
  b?.click();
})()`);

// Wysyłka jest ograniczona do jednej na 15 s, więc dajemy jej okno czasowe.
let poZmianie = null;
for (let i = 0; i < 45 && !poZmianie; i += 1) {
  await sleep(500);
  const wszystkie = odebrane.filter((r) => r.dane?.cmd === 'SET_ACTIVITY');
  if (wszystkie.length > przedZmiana) poZmianie = wszystkie[wszystkie.length - 1];
}
sprawdz(
  'przełączenie zakładki aktualizuje status',
  poZmianie?.dane?.args?.activity?.state === 'Ustawienia',
  String(poZmianie?.dane?.args?.activity?.state)
);

// Wyłączenie wtyczki czyści status (aktywność bez treści) i zamyka gniazdo.
const przedWylaczeniem = odebrane.length;
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, false)`);
await sleep(2500);
const czyszczenie = odebrane
  .slice(przedWylaczeniem)
  .find((r) => r.dane?.cmd === 'SET_ACTIVITY' && r.dane?.args?.activity === undefined);
sprawdz('wyłączenie czyści status w Discordzie', Boolean(czyszczenie), JSON.stringify(czyszczenie?.dane?.args));

console.log('\nWYNIKI (Discord Rich Presence)');
console.log('─'.repeat(60));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(60));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);

klient?.destroy();
serwer.close();
ws.close();
process.exit(bledy === 0 ? 0 : 1);
