/**
 * Test E2E przeglądarki SFTP.
 *
 * Serwer ssh2 z minimalnym podsystemem SFTP działa w procesie testu i serwuje stałe
 * drzewo w pamięci. Aplikacja łączy się przez SSH, otwiera panel SFTP i listuje katalog.
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

// Drzewo w pamięci: /home/tester z plikiem, katalogiem i drugim plikiem.
const HOME = '/home/tester';
const tree = {
  [HOME]: [
    { name: 'readme.txt', dir: false, content: Buffer.from('Zawartosc pliku SFTP\n') },
    { name: 'projekt', dir: true },
    { name: 'dane.bin', dir: false, content: Buffer.from([1, 2, 3, 4]) }
  ],
  [`${HOME}/projekt`]: [{ name: 'main.c', dir: false, content: Buffer.from('int main(){}\n') }]
};

const DIR_ATTRS = { mode: 0o40755, size: 0, uid: 1000, gid: 1000, atime: 0, mtime: 0 };
const fileAttrs = (size) => ({ mode: 0o100644, size, uid: 1000, gid: 1000, atime: 0, mtime: 0 });

function handleSftp(sftp) {
  const dirHandles = new Map(); // handle → { path, sent }
  const fileHandles = new Map(); // handle → { content, offset }
  let next = 0;
  const newHandle = () => Buffer.from([next++ & 0xff]);

  sftp.on('REALPATH', (reqid, path) => {
    const abs = path === '.' || path === '' ? HOME : path;
    sftp.name(reqid, [{ filename: abs, longname: abs, attrs: DIR_ATTRS }]);
  });

  sftp.on('OPENDIR', (reqid, path) => {
    if (!tree[path]) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    const h = newHandle();
    dirHandles.set(h[0], { path, sent: false });
    sftp.handle(reqid, h);
  });

  sftp.on('READDIR', (reqid, handle) => {
    const state = dirHandles.get(handle[0]);
    if (!state || state.sent) return sftp.status(reqid, STATUS_CODE.EOF);
    state.sent = true;
    const names = tree[state.path].map((e) => ({
      filename: e.name,
      longname: e.name,
      attrs: e.dir ? DIR_ATTRS : fileAttrs(e.content.length)
    }));
    sftp.name(reqid, names);
  });

  const statOf = (path) => {
    if (tree[path]) return DIR_ATTRS;
    for (const [dir, entries] of Object.entries(tree)) {
      const e = entries.find((x) => `${dir}/${x.name}` === path);
      if (e) return e.dir ? DIR_ATTRS : fileAttrs(e.content?.length ?? 0);
    }
    return null;
  };
  const onStat = (reqid, path) => {
    const a = statOf(path);
    if (a) sftp.attrs(reqid, a);
    else sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
  };
  sftp.on('STAT', onStat);
  sftp.on('LSTAT', onStat);

  sftp.on('OPEN', (reqid, filename, flags) => {
    if (!(flags & OPEN_MODE.READ)) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    for (const [dir, entries] of Object.entries(tree)) {
      const e = entries.find((x) => `${dir}/${x.name}` === filename && !x.dir);
      if (e) {
        const h = newHandle();
        fileHandles.set(h[0], { content: e.content, offset: 0 });
        return sftp.handle(reqid, h);
      }
    }
    sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
  });

  sftp.on('READ', (reqid, handle, offset, length) => {
    const f = fileHandles.get(handle[0]);
    if (!f) return sftp.status(reqid, STATUS_CODE.FAILURE);
    if (offset >= f.content.length) return sftp.status(reqid, STATUS_CODE.EOF);
    sftp.data(reqid, f.content.subarray(offset, offset + length));
  });

  sftp.on('CLOSE', (reqid, handle) => {
    dirHandles.delete(handle[0]);
    fileHandles.delete(handle[0]);
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

// realpath('.') → katalog domowy
const home = await ev(`window.luma.sftp.realpath(${JSON.stringify(sid)}, '.')`);
sprawdz('realpath . → katalog domowy', home === HOME, home);

// list domowego katalogu
const list = await ev(`window.luma.sftp.list(${JSON.stringify(sid)}, ${JSON.stringify(HOME)})`);
const names = Array.isArray(list) ? list.map((e) => e.name) : [];
sprawdz('listuje readme.txt', names.includes('readme.txt'), JSON.stringify(names));
sprawdz('listuje katalog projekt jako dir', list?.find((e) => e.name === 'projekt')?.type === 'dir');
sprawdz('plik ma rozmiar', (list?.find((e) => e.name === 'readme.txt')?.size ?? 0) > 0);

// wejście w podkatalog
const sub = await ev(`window.luma.sftp.list(${JSON.stringify(sid)}, ${JSON.stringify(`${HOME}/projekt`)})`);
sprawdz('podkatalog zawiera main.c', Array.isArray(sub) && sub.some((e) => e.name === 'main.c'));

console.log('\nWYNIKI (SFTP)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
server.close();
ws.close();
process.exit(bledy === 0 ? 0 : 1);
