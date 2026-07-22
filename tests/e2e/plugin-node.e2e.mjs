/**
 * Test E2E wtyczek z własnym procesem (Plugin API v2, etap 1).
 *
 * Sprawdza to, co odróżnia nowy runtime od piaskownicy v1:
 *  - wtyczka `runtime: "node"` NIE startuje sama, dopóki użytkownik jej nie włączy,
 *  - po włączeniu ma własny proces z pełnym Node,
 *  - „Zatrzymaj" naprawdę kończy proces (a `deactivate()` jest wołane),
 *  - „Przeładuj" podnosi wtyczkę z nowym kodem BEZ restartu aplikacji,
 *  - wyłączenie odbiera zgodę, więc po restarcie proces znowu nie wstanie.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222 oraz wbudowanej wtyczki `probe-node`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ID = 'com.lumashell.probe-node';
const base = 'http://127.0.0.1:9222';

const targets = await (await fetch(`${base}/json`)).json();
const page = targets.find(
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

const wtyczka = async () =>
  ev(`window.luma.plugins.installed().then(l => l.find(p => p.id === ${JSON.stringify(ID)}))`);

// --- stan wyjściowy: znaleziona, ale NIE uruchomiona ---
// Test zaczyna od czystego stanu: jeśli poprzedni przebieg zostawił zgodę, cofamy ją.
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, false)`);
await sleep(800);

let p = await wtyczka();
sprawdz('wtyczka probe-node wykryta', Boolean(p), JSON.stringify(p?.id));
sprawdz('zgłasza runtime "node"', p?.runtime === 'node', p?.runtime);
sprawdz('bez zgody NIE jest włączona', p?.enabled === false, String(p?.enabled));
sprawdz('bez zgody proces nie działa', p?.proces?.stan === 'zatrzymana', p?.proces?.stan);

// --- włączenie = zgoda; proces wstaje ---
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, true)`);
for (let i = 0; i < 30; i += 1) {
  await sleep(200);
  p = await wtyczka();
  if (p?.proces?.stan === 'dziala') break;
}
sprawdz('po włączeniu proces działa', p?.proces?.stan === 'dziala', JSON.stringify(p?.proces));
sprawdz('proces ma PID', typeof p?.proces?.pid === 'number', String(p?.proces?.pid));
const pierwszyPid = p?.proces?.pid;

// Log wtyczki jest dowodem, CO widzi kod w tym procesie.
const logPath = p?.proces?.logPath;
await sleep(600);
let log = '';
try {
  log = readFileSync(logPath, 'utf8');
} catch (e) {
  log = `BŁĄD ODCZYTU: ${e.message}`;
}
sprawdz('log wtyczki powstał', log.includes('sonda wtyczki'), logPath ? join(logPath) : 'brak ścieżki');
sprawdz('wtyczka ma pełny Node', /node\s+: 24\./.test(log) && log.includes('fs.readFileSync   : function'), '');
sprawdz(
  'wtyczka NIE ma Electrona poza net/systemPreferences',
  log.includes('require(electron) : ["net","systemPreferences"]'),
  ''
);
sprawdz(
  'model uprawnień Node nieaktywny (mówimy o tym wprost)',
  log.includes('process.permission: undefined'),
  ''
);

// --- zatrzymanie kończy proces i woła deactivate() ---
await ev(`window.luma.plugins.stop(${JSON.stringify(ID)})`);
await sleep(1500);
p = await wtyczka();
sprawdz('po zatrzymaniu proces nie działa', p?.proces?.stan === 'zatrzymana', p?.proces?.stan);
log = readFileSync(logPath, 'utf8');
sprawdz('wtyczka dostała deactivate()', log.includes('deactivate() wywołane'), '');
sprawdz('proces zakończył się czysto', log.includes('--- koniec (kod 0) ---'), '');

// --- przeładowanie bez restartu aplikacji ---
await ev(`window.luma.plugins.reload(${JSON.stringify(ID)})`);
for (let i = 0; i < 30; i += 1) {
  await sleep(200);
  p = await wtyczka();
  if (p?.proces?.stan === 'dziala') break;
}
sprawdz('po przeładowaniu proces znów działa', p?.proces?.stan === 'dziala', p?.proces?.stan);
sprawdz(
  'przeładowanie dało NOWY proces',
  typeof p?.proces?.pid === 'number' && p.proces.pid !== pierwszyPid,
  `${pierwszyPid} → ${p?.proces?.pid}`
);

// --- wyłączenie odbiera zgodę ---
await ev(`window.luma.plugins.setEnabled(${JSON.stringify(ID)}, false)`);
await sleep(1500);
p = await wtyczka();
sprawdz('wyłączenie zatrzymuje proces', p?.proces?.stan === 'zatrzymana', p?.proces?.stan);
sprawdz('wyłączona wtyczka nie jest włączona', p?.enabled === false, String(p?.enabled));

console.log('\nWYNIKI (wtyczki z własnym procesem)');
console.log('─'.repeat(60));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(60));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
