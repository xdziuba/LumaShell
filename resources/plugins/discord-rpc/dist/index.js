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
/** Klucz zasobu z Developer Portal. Pusty = wysyłamy status BEZ grafiki. */
let assetKey = 'lumashell';
/** Co poszło i co wróciło — do komendy „diagnostyka" i do logu. */
let ostatniLadunek = null;
let ostatniaOdpowiedz = null;
/** Czy Discord POTWIERDZIŁ przyjęcie statusu (samo połączenie to za mało). */
let statusPrzyjety = false;
/** Ochrona przed pętlą: po odrzuceniu próbujemy raz bez grafiki. */
let probaBezGrafiki = false;

function loguj(...args) {
  console.log('[discord]', ...args);
}

/** Wskaźnik na pasku statusu — jedyne miejsce, gdzie widać stan bez otwierania palety. */
async function odswiezWskaznik() {
  if (!ctx) return;
  await ctx.ui
    .setStatusBarItem({
      id: 'stan',
      text: !polaczone ? 'Discord ○' : statusPrzyjety ? 'Discord ●' : 'Discord ◐',
      tooltip: !polaczone
        ? `Brak połączenia${ostatniBlad ? ` — ${ostatniBlad}` : ''}. Kliknij, aby spróbować ponownie.`
        : statusPrzyjety
          ? `Status ustawiony${probaBezGrafiki ? ' (bez grafiki)' : ''}. Nazwy zakładek: ${pokazujZakladki ? 'widoczne' : 'ukryte'}.`
          : `Połączono, ale Discord nie potwierdził statusu${ostatniBlad ? ` — ${ostatniBlad}` : ''}. Uruchom „Discord: diagnostyka".`,
      command: 'discord.reconnect'
    })
    .catch(() => undefined);
}

/** Aktywność pokazywana w Discordzie. `details` to górna linia, `state` dolna. */
function zbudujAktywnosc(info) {
  // Discord wymaga, żeby `details` i `state` miały co najmniej 2 znaki — krótsza nazwa
  // zakładki wywróciłaby cały ładunek, a status po prostu by się nie pokazał.
  const nazwa = pokazujZakladki && aktywnaZakladka ? aktywnaZakladka.title.slice(0, 120) : 'Terminal';
  const aktywnosc = {
    details: 'LumaShell',
    state: nazwa.length >= 2 ? nazwa : `${nazwa} `,
    timestamps: { start: startSesji },
    instance: false
  };
  // Grafika jest opcjonalna: klucz musi istnieć w Developer Portal, a jego brak potrafi
  // sprawić, że Discord odrzuci CAŁY ładunek i status nie pojawi się wcale.
  if (assetKey && !probaBezGrafiki) {
    aktywnosc.assets = { large_image: assetKey, large_text: `LumaShell ${info.version}` };
  }
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
  ostatniLadunek = ladunek;
  loguj('wysyłam SET_ACTIVITY:', JSON.stringify(ladunek.args.activity));
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

  ostatniBlad = '';
  statusPrzyjety = false;
  probaBezGrafiki = false;
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
        ostatniaOdpowiedz = dane;
        statusPrzyjety = false;
        ostatniBlad = `Discord odrzucił: ${dane?.data?.message ?? 'nieznany błąd'} (kod ${dane?.data?.code ?? '?'})`;
        loguj(ostatniBlad, '| pełna odpowiedź:', JSON.stringify(dane));
        // Najczęstsza przyczyna odrzucenia to klucz grafiki, którego nie ma w Developer
        // Portal. Próbujemy raz bez niej, zamiast zostawiać użytkownika z pustym statusem.
        if (!probaBezGrafiki && assetKey) {
          probaBezGrafiki = true;
          loguj('ponawiam BEZ grafiki — sprawdź, czy w Developer Portal jest zasób o kluczu', assetKey);
          void wyslijStatus();
        }
        void odswiezWskaznik();
      } else if (op === OP.FRAME && dane?.cmd === 'SET_ACTIVITY') {
        // Potwierdzenie: dopiero teraz wiadomo, że status naprawdę poszedł.
        ostatniaOdpowiedz = dane;
        statusPrzyjety = true;
        ostatniBlad = '';
        loguj('Discord przyjął status', probaBezGrafiki ? '(bez grafiki)' : '');
        void odswiezWskaznik();
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

  const zapisanyId = await ctx.storage.get('clientId');
  clientId = typeof zapisanyId === 'string' ? zapisanyId.trim() : '';
  const zapisanaOpcja = await ctx.storage.get('pokazujNazwyZakladek');
  if (typeof zapisanaOpcja === 'boolean') pokazujZakladki = zapisanaOpcja;
  const zapisanyAsset = await ctx.storage.get('assetKey');
  if (typeof zapisanyAsset === 'string') assetKey = zapisanyAsset.trim();

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

  await ctx.commands.registerCommand('discord.diagnostyka', async () => {
    // Cały stan w jednym miejscu: co wysłano, co wróciło i czego szukać po stronie
    // Discorda. Bez tego „połączono, a statusu nie widać" jest nie do rozstrzygnięcia.
    const gdzie = await ctx.storage.path();
    const raport = [
      '--- diagnostyka Discord RPC ---',
      `gniazdo:            ${gniazdo ? 'otwarte' : 'zamknięte'}`,
      `uzgodnienie (READY): ${polaczone ? 'tak' : 'nie'}`,
      `status potwierdzony: ${statusPrzyjety ? 'tak' : 'NIE'}`,
      `client ID:          ${clientId ? `${clientId.slice(0, 4)}…${clientId.slice(-4)} (${clientId.length} znaków)` : 'BRAK'}`,
      `klucz grafiki:      ${assetKey || '(brak — status bez obrazka)'}${probaBezGrafiki ? ' [wyłączony po odrzuceniu]' : ''}`,
      `nazwy zakładek:     ${pokazujZakladki ? 'widoczne' : 'ukryte'}`,
      `ostatni błąd:       ${ostatniBlad || '(brak)'}`,
      `ostatnio wysłane:   ${ostatniLadunek ? JSON.stringify(ostatniLadunek.args.activity) : '(nic)'}`,
      `ostatnia odpowiedź: ${ostatniaOdpowiedz ? JSON.stringify(ostatniaOdpowiedz) : '(brak)'}`,
      `plik ustawień:      ${gdzie}`,
      '',
      'Jeśli status jest potwierdzony, a w Discordzie go nie widać, sprawdź w Discordzie:',
      'Ustawienia → Aktywność (Activity Privacy) → „Wyświetlaj bieżącą aktywność jako status".',
      'To ustawienie jest po stronie Discorda i żadna wtyczka go nie obejdzie.'
    ].join('\n');
    console.log(raport);
    await ctx.notifications.show(
      statusPrzyjety
        ? 'Discord: status POTWIERDZONY przez Discorda — jeśli go nie widać, włącz w Discordzie „Wyświetlaj bieżącą aktywność jako status". Szczegóły w logu wtyczki.'
        : `Discord: status NIE potwierdzony${ostatniBlad ? ` — ${ostatniBlad}` : ''}. Szczegóły w logu wtyczki.`,
      statusPrzyjety ? 'info' : 'warn'
    );
  });

  await ctx.commands.registerCommand('discord.reconnect', async () => {
    rozlacz();
    if (timerPonowienia) {
      clearTimeout(timerPonowienia);
      timerPonowienia = null;
    }
    opoznieniePonowienia = 5000;
    // Client ID czytamy PONOWNIE: typowy przebieg to „wpisz go w pliku i połącz ponownie",
    // a bez tego komenda używałaby wartości sprzed edycji i wyglądała na zepsutą.
    const swiezy = await ctx.storage.get('clientId');
    if (typeof swiezy === 'string' && swiezy.trim()) clientId = swiezy.trim();
    if (!clientId) {
      const gdzie = await ctx.storage.path();
      await ctx.notifications.show(`Discord: najpierw wpisz Application ID w pole "clientId" w ${gdzie}`, 'warn');
      return;
    }
    await polacz();
    // Uzgodnienie jest wysłane, ale READY przychodzi chwilę później — bez tego meldunek
    // mówiłby „brak połączenia" w momencie, w którym połączenie właśnie się udaje.
    for (let i = 0; i < 20 && gniazdo && !polaczone; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await odswiezWskaznik();
    await ctx.notifications.show(polaczone ? 'Discord: połączono' : `Discord: ${ostatniBlad || 'próbuję dalej…'}`);
  });

  await odswiezWskaznik();
  loguj(`start na ${os.platform()}, sesja od ${new Date(startSesji).toISOString()}`);

  if (!clientId) {
    // Rich Presence wymaga aplikacji założonej w Discord Developer Portal — bez jej
    // identyfikatora Discord odrzuci uzgodnienie.
    //
    // Sam ODCZYT magazynu nie tworzy pliku, więc zakładamy go tutaj z pustym szablonem.
    // Inaczej użytkownik dostaje ścieżkę do pliku, którego nie ma, i musi się domyślić
    // zarówno nazwy pola, jak i formatu.
    const gdzie = await ctx.storage.path();
    // Uwaga: magazyn wraca przez RPC, a JSON nie zna `undefined` — brak wartości przychodzi
    // jako `null`. Dlatego pytamy o TYP, a nie o `=== undefined`.
    if (typeof zapisanyId !== 'string') {
      await ctx.storage.set('clientId', '');
      await ctx.storage.set(
        '_jakUstawic',
        'Wklej Application ID aplikacji z https://discord.com/developers/applications w pole ' +
          'clientId (same cyfry, w cudzysłowie), zapisz plik i uruchom komendę ' +
          '"Discord: połącz ponownie" z palety (Ctrl+Shift+P).'
      );
      loguj('utworzono plik ustawień z szablonem:', gdzie);
    }
    loguj('brak Client ID — uzupełnij pole "clientId" w pliku', gdzie);
    await ctx.notifications.show(
      `Discord RPC: wpisz Application ID w pole "clientId" w pliku ${gdzie}, potem komenda „Discord: połącz ponownie"`,
      'warn'
    );
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
