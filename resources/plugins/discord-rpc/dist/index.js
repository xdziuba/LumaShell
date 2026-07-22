'use strict';

/**
 * Discord Rich Presence dla LumaShella — wtyczka referencyjna Plugin API v2.
 *
 * Dowód, że nowy runtime wystarcza do realnej integracji: cały transport to `node:net`
 * w procesie wtyczki, BEZ ani jednej linii nowego API po stronie aplikacji. Od LumaShella
 * wtyczka bierze tylko to, czego sama nie wie: nazwę i wersję aplikacji, czas startu sesji
 * oraz nazwę aktywnej zakładki.
 *
 * Protokół Discord IPC (lokalny, nieudokumentowany oficjalnie, ale stabilny od lat):
 *   ramka = op(uint32 LE) + długość(uint32 LE) + JSON w UTF-8
 *   op 0 HANDSHAKE, 1 FRAME, 2 CLOSE, 3 PING, 4 PONG
 * Gniazdo to nazwany potok `\\.\pipe\discord-ipc-N` (Windows) albo gniazdo uniksowe
 * w katalogu tymczasowym (Linux/macOS). Numerów jest 10 — Discord zajmuje pierwszy wolny.
 *
 * Prywatność: nazwa zakładki bywa nazwą hosta SSH, więc pokazywanie jej jest opcją i da się
 * ją wyłączyć komendą. Domyślnie jest włączona, ale plik ustawień mówi o tym wprost.
 */

const net = require('node:net');
const os = require('node:os');

// --- ramkowanie ----------------------------------------------------------------------

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function ramka(op, dane) {
  const tresc = Buffer.from(JSON.stringify(dane), 'utf8');
  const naglowek = Buffer.alloc(8);
  naglowek.writeInt32LE(op, 0);
  naglowek.writeInt32LE(tresc.length, 4);
  return Buffer.concat([naglowek, tresc]);
}

/**
 * Parser strumieniowy: potok tnie dane dowolnie, więc nie wolno zakładać, że jedna porcja
 * to jedna ramka. Zwraca komplet ramek i zostawia resztę w buforze.
 */
function czytajRamki(bufor) {
  const ramki = [];
  let reszta = bufor;
  for (;;) {
    if (reszta.length < 8) break;
    const op = reszta.readInt32LE(0);
    const dlugosc = reszta.readInt32LE(4);
    if (reszta.length < 8 + dlugosc) break;
    const tresc = reszta.subarray(8, 8 + dlugosc).toString('utf8');
    reszta = reszta.subarray(8 + dlugosc);
    try {
      ramki.push({ op, dane: JSON.parse(tresc) });
    } catch {
      ramki.push({ op, dane: null });
    }
  }
  return { ramki, reszta };
}

/** Ścieżki gniazd Discorda: na Windows nazwane potoki, gdzie indziej gniazda uniksowe. */
function sciezkiGniazd() {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`);
  }
  const baza =
    process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return Array.from({ length: 10 }, (_, i) => `${baza.replace(/\/$/, '')}/discord-ipc-${i}`);
}

// --- stan wtyczki --------------------------------------------------------------------

/** Discord przycina częste aktualizacje statusu; trzymamy się bezpiecznego odstępu. */
const ODSTEP_MS = 15_000;

let ctx;
let gniazdo = null;
let polaczone = false;
let clientId = '';
let pokazujZakladki = true;
let aktywnaZakladka = null;
let startSesji = Date.now();
let bufor = Buffer.alloc(0);
let timerPonowienia = null;
let timerWysylki = null;
let opoznieniePonowienia = 5000;
let ostatniBlad = '';
let ostatniaWysylka = 0;

function loguj(...args) {
  console.log('[discord]', ...args);
}

/** Wskaźnik na pasku statusu — jedyne miejsce, gdzie widać stan bez otwierania palety. */
async function odswiezWskaznik() {
  if (!ctx) return;
  await ctx.ui
    .setStatusBarItem({
      id: 'stan',
      text: polaczone ? 'Discord ●' : 'Discord ○',
      tooltip: polaczone
        ? `Połączono. Nazwy zakładek: ${pokazujZakladki ? 'widoczne' : 'ukryte'}.`
        : `Brak połączenia${ostatniBlad ? ` — ${ostatniBlad}` : ''}. Kliknij, aby spróbować ponownie.`,
      command: 'discord.reconnect'
    })
    .catch(() => undefined);
}

/** Aktywność pokazywana w Discordzie. `details` to górna linia, `state` dolna. */
function zbudujAktywnosc(info) {
  const aktywnosc = {
    details: 'LumaShell',
    state: pokazujZakladki && aktywnaZakladka ? aktywnaZakladka.title.slice(0, 120) : 'Terminal',
    timestamps: { start: startSesji },
    assets: { large_image: 'lumashell', large_text: `LumaShell ${info.version}` },
    instance: false
  };
  return aktywnosc;
}

async function wyslijStatus() {
  if (!polaczone || !gniazdo) return;
  const info = await ctx.app.getInfo().catch(() => ({ name: 'LumaShell', version: '?', startedAt: startSesji }));
  const ladunek = {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: zbudujAktywnosc(info) },
    nonce: `${Date.now()}-${Math.floor(process.hrtime()[1] % 100000)}`
  };
  gniazdo.write(ramka(OP.FRAME, ladunek));
}

/**
 * Wysyła status nie częściej niż co ODSTEP_MS — Discord przycina zbyt częste aktualizacje.
 *
 * Pierwsza zmiana po ciszy idzie natychmiast (opóźnienie wychodzi zerowe), a seria szybkich
 * przełączeń zakładek zamienia się w jedną wysyłkę na końcu okna.
 */
function zaplanujWysylke() {
  if (timerWysylki) return;
  const opoznienie = Math.max(0, ODSTEP_MS - (Date.now() - ostatniaWysylka));
  timerWysylki = setTimeout(() => {
    timerWysylki = null;
    ostatniaWysylka = Date.now();
    void wyslijStatus();
  }, opoznienie);
}

// --- połączenie ----------------------------------------------------------------------

function rozlacz() {
  const bylo = polaczone;
  if (gniazdo) {
    gniazdo.removeAllListeners();
    gniazdo.destroy();
  }
  gniazdo = null;
  polaczone = false;
  bufor = Buffer.alloc(0);
  if (bylo) void odswiezWskaznik();
}

function zaplanujPonowienie() {
  if (timerPonowienia) return;
  timerPonowienia = setTimeout(() => {
    timerPonowienia = null;
    void polacz();
  }, opoznieniePonowienia);
  // Backoff z sufitem: Discord bywa wyłączony godzinami, nie ma sensu pukać co sekundę.
  opoznieniePonowienia = Math.min(opoznieniePonowienia * 2, 60_000);
}

/** Próbuje kolejnych gniazd, aż któreś odpowie. */
function polaczZGniazdem(sciezki, indeks) {
  return new Promise((resolve) => {
    if (indeks >= sciezki.length) return resolve(null);
    const s = net.connect({ path: sciezki[indeks] });
    const dalej = () => {
      s.removeAllListeners();
      s.destroy();
      resolve(polaczZGniazdem(sciezki, indeks + 1));
    };
    s.once('connect', () => {
      s.removeAllListeners('error');
      resolve(s);
    });
    s.once('error', dalej);
  });
}

async function polacz() {
  if (gniazdo) return;
  if (!clientId) {
    ostatniBlad = 'brak Client ID';
    return;
  }

  const s = await polaczZGniazdem(sciezkiGniazd(), 0);
  if (!s) {
    ostatniBlad = 'nie znaleziono działającego Discorda';
    zaplanujPonowienie();
    return;
  }
  gniazdo = s;

  s.on('data', (porcja) => {
    bufor = Buffer.concat([bufor, porcja]);
    const wynik = czytajRamki(bufor);
    bufor = wynik.reszta;
    for (const { op, dane } of wynik.ramki) {
      if (op === OP.PING) {
        s.write(ramka(OP.PONG, dane ?? {}));
      } else if (op === OP.FRAME && dane?.evt === 'READY') {
        polaczone = true;
        opoznieniePonowienia = 5000;
        ostatniBlad = '';
        loguj('połączono z Discordem jako', dane?.data?.user?.username ?? 'nieznany użytkownik');
        void wyslijStatus();
        void odswiezWskaznik();
      } else if (op === OP.FRAME && dane?.evt === 'ERROR') {
        ostatniBlad = `Discord odrzucił: ${dane?.data?.message ?? 'nieznany błąd'}`;
        loguj(ostatniBlad);
      } else if (op === OP.CLOSE) {
        ostatniBlad = `Discord zamknął połączenie: ${dane?.message ?? ''}`;
        rozlacz();
        zaplanujPonowienie();
      }
    }
  });

  s.on('error', (error) => {
    ostatniBlad = error.message;
    rozlacz();
    zaplanujPonowienie();
  });
  s.on('close', () => {
    if (!polaczone) ostatniBlad = ostatniBlad || 'połączenie zamknięte';
    rozlacz();
    zaplanujPonowienie();
  });

  // Uzgodnienie: dopiero po nim Discord przysyła READY.
  s.write(ramka(OP.HANDSHAKE, { v: 1, client_id: clientId }));
}

// --- cykl życia ----------------------------------------------------------------------

exports.activate = async function activate(context) {
  ctx = context;

  const info = await ctx.app.getInfo().catch(() => null);
  if (info) startSesji = info.startedAt;

  clientId = (await ctx.storage.get('clientId')) || '';
  const zapisanaOpcja = await ctx.storage.get('pokazujNazwyZakladek');
  if (typeof zapisanaOpcja === 'boolean') pokazujZakladki = zapisanaOpcja;

  aktywnaZakladka = await ctx.workspace.getActiveTab().catch(() => null);
  ctx.workspace.onDidChangeActiveTab((tab) => {
    aktywnaZakladka = tab;
    zaplanujWysylke();
  });

  await ctx.commands.registerCommand('discord.status', async () => {
    const gdzie = await ctx.storage.path();
    await ctx.notifications.show(
      polaczone
        ? `Discord: połączono. Zakładki ${pokazujZakladki ? 'pokazywane' : 'ukryte'}.`
        : `Discord: brak połączenia${ostatniBlad ? ` (${ostatniBlad})` : ''}. Ustawienia: ${gdzie}`,
      polaczone ? 'info' : 'warn'
    );
  });

  await ctx.commands.registerCommand('discord.toggleTabNames', async () => {
    pokazujZakladki = !pokazujZakladki;
    await ctx.storage.set('pokazujNazwyZakladek', pokazujZakladki);
    zaplanujWysylke();
    await odswiezWskaznik();
    await ctx.notifications.show(
      pokazujZakladki ? 'Discord: nazwy zakładek będą widoczne' : 'Discord: nazwy zakładek ukryte'
    );
  });

  await ctx.commands.registerCommand('discord.reconnect', async () => {
    rozlacz();
    if (timerPonowienia) {
      clearTimeout(timerPonowienia);
      timerPonowienia = null;
    }
    opoznieniePonowienia = 5000;
    await polacz();
    await ctx.notifications.show(polaczone ? 'Discord: połączono' : `Discord: ${ostatniBlad || 'próbuję dalej…'}`);
  });

  await odswiezWskaznik();
  loguj(`start na ${os.platform()}, sesja od ${new Date(startSesji).toISOString()}`);

  if (!clientId) {
    // Rich Presence wymaga aplikacji założonej w Discord Developer Portal — bez jej
    // identyfikatora Discord odrzuci uzgodnienie. Mówimy to wprost i podajemy gdzie.
    const gdzie = await ctx.storage.path();
    loguj('brak Client ID — ustaw pole "clientId" w pliku', gdzie);
    await ctx.notifications.show(`Discord RPC: ustaw clientId w ${gdzie} (szczegóły w README wtyczki)`, 'warn');
    return;
  }

  await polacz();
};

exports.deactivate = async function deactivate() {
  if (timerPonowienia) clearTimeout(timerPonowienia);
  if (timerWysylki) clearTimeout(timerWysylki);
  // Uprzejme pożegnanie: status znika z Discorda od razu, a nie po jego własnym timeoucie.
  if (polaczone && gniazdo) {
    try {
      gniazdo.write(ramka(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: `${Date.now()}` }));
    } catch {
      // Zerwane gniazdo w trakcie zamykania nie jest problemem.
    }
  }
  rozlacz();
  loguj('zatrzymano');
};
