/**
 * Test E2E menedżera plików SFTP.
 *
 * Serwer ssh2 z podsystemem SFTP działa w procesie testu i serwuje drzewo trzymane w
 * pamięci — razem z operacjami ZAPISU (mkdir, rename, remove, rmdir, setstat, write), więc
 * sprawdzamy pełną ścieżkę: renderer → preload → sftp-ipc → ssh2 → serwer.
 *
 * Transfery na dysk lokalny (wyślij/pobierz) wymagają natywnego okna wyboru, którego nie da
 * się kliknąć bez interakcji — one są sprawdzane ręcznie. Tu weryfikujemy całą resztę oraz
 * kopiowanie zdalne, które i tak przechodzi przez strumienie odczytu i zapisu.
 *
 * Wymaga aplikacji z --remote-debugging-port=9222.
 */

import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
});

const HOME = '/home/tester';

/**
 * System plików w pamięci: płaska mapa ścieżka → wpis. Płasko, bo operacje zmieniają
 * strukturę (rename, mkdir, remove) i drzewo zagnieżdżone tylko by tu przeszkadzało.
 */
const fs = new Map();
const teraz = 1_700_000_000; // stały czas modyfikacji — test ma być powtarzalny

function reset() {
  fs.clear();
  fs.set(HOME, { dir: true, mode: 0o755, mtime: teraz });
  fs.set(`${HOME}/readme.txt`, { dir: false, content: Buffer.from('Zawartosc pliku SFTP\n'), mode: 0o644, mtime: teraz });
  fs.set(`${HOME}/projekt`, { dir: true, mode: 0o755, mtime: teraz });
  fs.set(`${HOME}/projekt/main.c`, { dir: false, content: Buffer.from('int main(){}\n'), mode: 0o644, mtime: teraz });
  fs.set(`${HOME}/dane.bin`, { dir: false, content: Buffer.from([1, 2, 3, 4]), mode: 0o600, mtime: teraz });
}
reset();

const dzieci = (dir) => {
  const prefix = `${dir.replace(/\/+$/, '')}/`;
  return [...fs.entries()]
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map(([path, entry]) => ({ name: path.slice(prefix.length), entry }));
};

const attrsOf = (entry) => ({
  mode: (entry.dir ? 0o40000 : 0o100000) | entry.mode,
  size: entry.dir ? 0 : entry.content.length,
  uid: 1000,
  gid: 1000,
  atime: entry.mtime,
  mtime: entry.mtime
});

function handleSftp(sftp) {
  const dirHandles = new Map();
  const fileHandles = new Map();
  let next = 0;
  const newHandle = () => Buffer.from([next++ & 0xff]);

  sftp.on('REALPATH', (reqid, path) => {
    const abs = path === '.' || path === '' ? HOME : path;
    sftp.name(reqid, [{ filename: abs, longname: abs, attrs: attrsOf(fs.get(abs) ?? { dir: true, mode: 0o755, mtime: teraz }) }]);
  });

  sftp.on('OPENDIR', (reqid, path) => {
    const entry = fs.get(path.replace(/\/+$/, '') || '/');
    if (!entry?.dir) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    const h = newHandle();
    dirHandles.set(h[0], { path: path.replace(/\/+$/, ''), sent: false });
    sftp.handle(reqid, h);
  });

  sftp.on('READDIR', (reqid, handle) => {
    const state = dirHandles.get(handle[0]);
    if (!state || state.sent) return sftp.status(reqid, STATUS_CODE.EOF);
    state.sent = true;
    const names = dzieci(state.path).map(({ name, entry }) => ({
      filename: name,
      longname: name,
      attrs: attrsOf(entry)
    }));
    if (names.length === 0) return sftp.status(reqid, STATUS_CODE.EOF);
    sftp.name(reqid, names);
  });

  const onStat = (reqid, path) => {
    const entry = fs.get(path);
    if (entry) sftp.attrs(reqid, attrsOf(entry));
    else sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
  };
  sftp.on('STAT', onStat);
  sftp.on('LSTAT', onStat);

  sftp.on('OPEN', (reqid, filename, flags) => {
    const h = newHandle();
    if (flags & OPEN_MODE.WRITE) {
      fileHandles.set(h[0], { path: filename, bufor: [], zapis: true });
      return sftp.handle(reqid, h);
    }
    const entry = fs.get(filename);
    if (!entry || entry.dir) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    fileHandles.set(h[0], { path: filename, content: entry.content, zapis: false });
    sftp.handle(reqid, h);
  });

  sftp.on('READ', (reqid, handle, offset, length) => {
    const f = fileHandles.get(handle[0]);
    if (!f || f.zapis) return sftp.status(reqid, STATUS_CODE.FAILURE);
    if (offset >= f.content.length) return sftp.status(reqid, STATUS_CODE.EOF);
    sftp.data(reqid, f.content.subarray(offset, offset + length));
  });

  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const f = fileHandles.get(handle[0]);
    if (!f?.zapis) return sftp.status(reqid, STATUS_CODE.FAILURE);
    f.bufor.push(Buffer.from(data));
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('CLOSE', (reqid, handle) => {
    const f = fileHandles.get(handle[0]);
    if (f?.zapis) {
      fs.set(f.path, { dir: false, content: Buffer.concat(f.bufor), mode: 0o644, mtime: teraz });
    }
    dirHandles.delete(handle[0]);
    fileHandles.delete(handle[0]);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('MKDIR', (reqid, path) => {
    if (fs.has(path)) return sftp.status(reqid, STATUS_CODE.FAILURE);
    fs.set(path, { dir: true, mode: 0o755, mtime: teraz });
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    const entry = fs.get(oldPath);
    if (!entry) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    fs.delete(oldPath);
    fs.set(newPath, entry);
    // Katalog zabiera ze sobą całą zawartość.
    for (const [path, value] of [...fs.entries()]) {
      if (path.startsWith(`${oldPath}/`)) {
        fs.delete(path);
        fs.set(newPath + path.slice(oldPath.length), value);
      }
    }
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('REMOVE', (reqid, path) => {
    if (!fs.has(path)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    fs.delete(path);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('RMDIR', (reqid, path) => {
    if (dzieci(path).length > 0) return sftp.status(reqid, STATUS_CODE.FAILURE);
    fs.delete(path);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('SETSTAT', (reqid, path, attrs) => {
    const entry = fs.get(path);
    if (!entry) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    if (typeof attrs.mode === 'number') entry.mode = attrs.mode & 0o7777;
    sftp.status(reqid, STATUS_CODE.OK);
  });
}

const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
  client.on('error', () => {});
  client.on('authentication', (ctx) => ctx.accept());
  client.on('ready', () => {
    client.on('session', (acceptSession) => {
      const session = acceptSession();
      session.on('sftp', (accept) => handleSftp(accept()));
      session.on('pty', (accept) => accept?.());
      session.on('shell', (accept) => accept().write('gotowy\r\n'));
    });
  });
});

const sshPort = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
console.log(`Serwer SFTP w procesie testu: 127.0.0.1:${sshPort}`);

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
    (r) => r.result?.result?.value ?? (r.result?.exceptionDetails ? `WYJATEK: ${r.result.exceptionDetails.text}` : undefined)
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');

const wyniki = [];
const sprawdz = (n, ok, d = '') => wyniki.push({ n, ok, d });

// Połącz SSH, akceptuj klucz hosta, poczekaj na sessionId.
const { connectionId } = await ev(`window.luma.ssh.connect(
  { host:'127.0.0.1', port:${sshPort}, username:'tester', auth:'password', password:'x' })`);
await ev(`(() => {
  window.__sid = null;
  window.luma.ssh.onHostVerify((r) => window.luma.ssh.respondHostVerify(r.requestId, true));
  window.luma.terminal.create({ kind:'ssh', connectionId:${JSON.stringify(connectionId)}, label:'s' }, 80, 24)
    .then(s => { window.__sid = s.sessionId; }).catch(e => { window.__sid = 'ERR:'+e; });
})()`);

let sid = null;
for (let i = 0; i < 60 && !sid; i += 1) {
  await sleep(150);
  sid = await ev('window.__sid');
}
sprawdz('sesja SSH zestawiona', typeof sid === 'string' && !sid.startsWith('ERR'), String(sid));

const S = JSON.stringify(sid);
const H = JSON.stringify(HOME);
const lista = (dir = HOME) => ev(`window.luma.sftp.list(${S}, ${JSON.stringify(dir)})`);

// --- odczyt ---
const home = await ev(`window.luma.sftp.realpath(${S}, '.')`);
sprawdz('realpath . → katalog domowy', home === HOME, home);

const list = await lista();
const names = Array.isArray(list) ? list.map((e) => e.name) : [];
sprawdz('listuje readme.txt', names.includes('readme.txt'), JSON.stringify(names));
sprawdz('listuje katalog projekt jako dir', list?.find((e) => e.name === 'projekt')?.type === 'dir');
sprawdz('plik ma rozmiar', (list?.find((e) => e.name === 'readme.txt')?.size ?? 0) > 0);
sprawdz('plik ma czas modyfikacji', (list?.find((e) => e.name === 'readme.txt')?.mtime ?? 0) > 0);
sprawdz(
  'plik ma bity uprawnien',
  list?.find((e) => e.name === 'dane.bin')?.mode === 0o600,
  String(list?.find((e) => e.name === 'dane.bin')?.mode?.toString(8))
);

const sub = await lista(`${HOME}/projekt`);
sprawdz('podkatalog zawiera main.c', Array.isArray(sub) && sub.some((e) => e.name === 'main.c'));

// --- tworzenie katalogu ---
await ev(`window.luma.sftp.mkdir(${S}, ${JSON.stringify(`${HOME}/nowy`)})`);
sprawdz('mkdir tworzy katalog', (await lista()).some((e) => e.name === 'nowy' && e.type === 'dir'));

// --- zmiana nazwy ---
await ev(`window.luma.sftp.rename(${S}, ${JSON.stringify(`${HOME}/readme.txt`)}, ${JSON.stringify(`${HOME}/przeczytaj.txt`)})`);
const poZmianie = (await lista()).map((e) => e.name);
sprawdz(
  'rename zmienia nazwe',
  poZmianie.includes('przeczytaj.txt') && !poZmianie.includes('readme.txt'),
  JSON.stringify(poZmianie)
);

// --- uprawnienia ---
await ev(`window.luma.sftp.chmod(${S}, ${JSON.stringify(`${HOME}/dane.bin`)}, 0o640)`);
sprawdz(
  'chmod ustawia prawa',
  (await lista()).find((e) => e.name === 'dane.bin')?.mode === 0o640,
  String((await lista()).find((e) => e.name === 'dane.bin')?.mode?.toString(8))
);

// --- kopiowanie (przechodzi przez strumienie odczytu i zapisu) ---
await ev(`window.luma.sftp.copy(${S}, [${JSON.stringify(`${HOME}/przeczytaj.txt`)}], ${JSON.stringify(`${HOME}/nowy`)})`);
const wNowym = await lista(`${HOME}/nowy`);
sprawdz('kopiowanie pliku do katalogu', wNowym.some((e) => e.name === 'przeczytaj.txt'), JSON.stringify(wNowym.map((e) => e.name)));
sprawdz(
  'kopia ma te sama tresc',
  fs.get(`${HOME}/nowy/przeczytaj.txt`)?.content?.toString() === 'Zawartosc pliku SFTP\n',
  String(fs.get(`${HOME}/nowy/przeczytaj.txt`)?.content)
);

// --- kopiowanie katalogu (rekurencyjne) ---
await ev(`window.luma.sftp.copy(${S}, [${JSON.stringify(`${HOME}/projekt`)}], ${JSON.stringify(`${HOME}/nowy`)})`);
sprawdz(
  'kopiowanie katalogu jest rekurencyjne',
  fs.has(`${HOME}/nowy/projekt/main.c`),
  [...fs.keys()].filter((k) => k.includes('/nowy/')).join(', ')
);

// --- przenoszenie ---
await ev(`window.luma.sftp.move(${S}, [${JSON.stringify(`${HOME}/dane.bin`)}], ${JSON.stringify(`${HOME}/nowy`)})`);
sprawdz(
  'przenoszenie usuwa ze zrodla i dodaje w celu',
  !fs.has(`${HOME}/dane.bin`) && fs.has(`${HOME}/nowy/dane.bin`)
);

// --- usuwanie rekurencyjne ---
await ev(`window.luma.sftp.delete(${S}, [${JSON.stringify(`${HOME}/nowy`)}])`);
sprawdz(
  'usuwanie katalogu razem z zawartoscia',
  ![...fs.keys()].some((k) => k.startsWith(`${HOME}/nowy`)),
  [...fs.keys()].join(', ')
);

// --- odporność: usunięcie nieistniejącej ścieżki musi dać błąd, nie ciszę ---
const blad = await ev(
  `window.luma.sftp.delete(${S}, [${JSON.stringify(`${HOME}/nie-ma-mnie`)}]).then(() => 'BRAK BLEDU').catch(e => 'BLAD')`
);
sprawdz('blad operacji wraca do renderera', blad === 'BLAD', String(blad));

console.log('\nWYNIKI (SFTP)');
console.log('─'.repeat(56));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(56));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
server.close();
ws.close();
process.exit(bledy === 0 ? 0 : 1);
