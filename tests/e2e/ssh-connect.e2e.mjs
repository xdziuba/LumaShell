/**
 * Test E2E połączenia SSH przez DevTools Protocol.
 *
 * Steruje wyłącznie rendererem LumaShell. Aplikacja łączy się z serwerem ssh2 w pamięci
 * (127.0.0.1) — pełen przepływ: dialog → connect → prompt weryfikacji hosta (TOFU) →
 * powitanie serwera w terminalu.
 *
 * Wymaga: uruchomionej aplikacji z --remote-debugging-port=9222 oraz portu serwera SSH
 * przekazanego argumentem: node ssh-connect.e2e.mjs <port>
 */

const sshPort = Number(process.argv[2]);
if (!sshPort) {
  console.error('podaj port serwera SSH');
  process.exit(2);
}

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

// Połącz przez SSH omijając ręczne wypełnianie formularza — wołamy API bezpośrednio,
// bo formularz i tak tylko buduje ten sam obiekt żądania.
const { connectionId, label } = await ev(`window.luma.ssh.connect(
  { host: '127.0.0.1', port: ${sshPort}, username: 'tester', auth: 'password', password: 'dowolne' })`);
sprawdz('ssh.connect zwraca connectionId', typeof connectionId === 'string' && connectionId.length > 0);
sprawdz('etykieta = user@host', label === 'tester@127.0.0.1', label);

// Ustaw nasłuch prośby o weryfikację hosta oraz zbieranie danych sesji — zanim otworzymy.
await ev(`(() => {
  window.__hostReq = null;
  window.__data = '';
  window.luma.ssh.onHostVerify((req) => { window.__hostReq = req; });
  window.luma.terminal.onData((e) => { window.__data += new TextDecoder().decode(e.data); });
})()`);

// Otwórz sesję SSH — BEZ await, bo create nie rozwiąże się, dopóki nie zaakceptujemy
// klucza hosta (handshake czeka na weryfikację). To dokładnie równoległość z prawdziwej
// aplikacji: renderer pokazuje dialog, gdy create jest w toku.
await ev(`(() => {
  window.__session = null;
  window.luma.terminal.create(
    { kind: 'ssh', connectionId: ${JSON.stringify(connectionId)}, label: ${JSON.stringify(label)} }, 80, 24)
    .then(s => { window.__session = s.sessionId; })
    .catch(e => { window.__session = 'BLAD:' + e; });
})()`);

// Poczekaj na prośbę o weryfikację (pierwszy kontakt = unknown).
let req = null;
for (let i = 0; i < 40 && !req; i += 1) {
  await sleep(150);
  req = await ev(`window.__hostReq`);
}
sprawdz('przyszła prośba o weryfikację hosta', req != null);
sprawdz('powód = unknown (pierwszy kontakt, TOFU)', req?.reason === 'unknown', req?.reason);
sprawdz('odcisk w formacie OpenSSH', typeof req?.fingerprint === 'string' && req.fingerprint.startsWith('SHA256:'));

// Zaakceptuj klucz hosta — handshake ruszy dalej.
if (req) await ev(`window.luma.ssh.respondHostVerify(${JSON.stringify(req.requestId)}, true)`);

// Poczekaj na powitanie serwera przez zestawioną sesję.
let data = '';
for (let i = 0; i < 40; i += 1) {
  await sleep(150);
  data = (await ev(`window.__data`)) ?? '';
  if (data.includes('POLACZONO')) break;
}
sprawdz('po akceptacji sesja połączona i przyszło powitanie', data.includes('POLACZONO-Z-SERWEREM-TESTOWYM'), `${data.length} B`);

console.log('\nWYNIKI (połączenie SSH)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
ws.close();
process.exit(bledy === 0 ? 0 : 1);
