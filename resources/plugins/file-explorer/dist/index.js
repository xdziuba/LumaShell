'use strict';

/**
 * File Explorer 2.0 — drzewo plików jako zakładka LumaShella.
 *
 * Wersja 1.0 tej wtyczki nie mogła istnieć: Plugin API v1 dawało wyłącznie komendy,
 * powiadomienia i narzędzia AI, więc zamiast eksploratora był w niej wykrywacz brakujących
 * zdolności. W API v2 wtyczka działa we własnym procesie z pełnym Node, więc katalogi czyta
 * WPROST przez `node:fs` — bez żadnego pośredniczącego API do plików.
 *
 * Rysowaniem zajmuje się aplikacja: wtyczka oddaje węzły drzewa (nazwa, opis, czy da się
 * rozwinąć), a LumaShell renderuje je w swoim motywie, ze swoim zaznaczaniem i nawigacją
 * klawiaturą. Dzięki temu widok wtyczki wygląda jak reszta aplikacji, a tu nie ma ani linii
 * HTML-a i CSS-a.
 *
 * Nic nie wychodzi na zewnątrz: wtyczka czyta katalogi i tyle.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const WIDOK = 'pliki';
/** Limit pozycji w jednym katalogu — węzeł z 200 tysiącami plików nikomu nie pomoże. */
const LIMIT_WPISOW = 2000;

let ctx;
let katalogGlowny = os.homedir();

function rozmiar(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const jednostki = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < jednostki.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${jednostki[i]}`;
}

/**
 * Dzieci węzła. `nodeId` to bezwzględna ścieżka katalogu (albo `null` dla korzenia).
 *
 * Identyfikatorem węzła jest ścieżka — dzięki temu komendy z drzewa (np. „otwórz terminal
 * tutaj") dostają od razu to, czego potrzebują, bez trzymania osobnej mapy węzłów.
 */
async function dzieci(nodeId) {
  const katalog = nodeId ?? katalogGlowny;
  let wpisy;
  try {
    wpisy = await fs.readdir(katalog, { withFileTypes: true });
  } catch (error) {
    // Brak uprawnień do katalogu jest normalny (np. C:\System Volume Information) —
    // pokazujemy powód w miejscu, w którym użytkownik go szuka, zamiast pustej gałęzi.
    return [{ id: `${katalog}::blad`, label: `(nie można otworzyć: ${error.code || error.message})` }];
  }

  const katalogi = [];
  const pliki = [];
  for (const wpis of wpisy.slice(0, LIMIT_WPISOW)) {
    const pelna = path.join(katalog, wpis.name);
    if (wpis.isDirectory()) {
      katalogi.push({
        id: pelna,
        label: wpis.name,
        expandable: true,
        command: 'fileExplorer.openTerminal'
      });
    } else if (wpis.isFile()) {
      let opis = '';
      try {
        opis = rozmiar((await fs.stat(pelna)).size);
      } catch {
        opis = '—';
      }
      pliki.push({ id: pelna, label: wpis.name, description: opis });
    }
  }

  katalogi.sort((a, b) => a.label.localeCompare(b.label));
  pliki.sort((a, b) => a.label.localeCompare(b.label));
  const razem = [...katalogi, ...pliki];
  if (wpisy.length > LIMIT_WPISOW) {
    razem.push({ id: `${katalog}::wiecej`, label: `… i ${wpisy.length - LIMIT_WPISOW} więcej (obcięte)` });
  }
  return razem;
}

async function odswiezWskaznik() {
  await ctx.ui
    .setStatusBarItem({
      id: 'katalog',
      text: `📁 ${path.basename(katalogGlowny) || katalogGlowny}`,
      tooltip: `Drzewo plików: ${katalogGlowny}`,
      command: 'fileExplorer.open'
    })
    .catch(() => undefined);
}

exports.activate = async function activate(context) {
  ctx = context;

  const zapisany = await ctx.storage.get('katalogGlowny');
  if (typeof zapisany === 'string' && zapisany) katalogGlowny = zapisany;

  await ctx.ui.registerTreeDataProvider(WIDOK, { getChildren: dzieci });

  await ctx.commands.registerCommand('fileExplorer.open', async () => {
    // Widok otwiera się z palety („Pliki (File Explorer)"), a ta komenda mówi gdzie jesteśmy.
    await ctx.notifications.show(`Drzewo plików: ${katalogGlowny} — otwórz je z palety: „Pliki"`);
  });

  await ctx.commands.registerCommand('fileExplorer.refresh', async () => {
    await ctx.ui.refreshView(WIDOK);
  });

  // Dwuklik na katalogu w drzewie → terminal w tym miejscu. Zamyka dwie rzeczy naraz:
  // przeglądanie i „chcę tu popracować".
  await ctx.commands.registerCommand('fileExplorer.openTerminal', async (nodeId) => {
    const cel = nodeId || katalogGlowny;
    await ctx.workspace.openTerminal(cel);
  });

  await ctx.commands.registerCommand('fileExplorer.setRoot', async () => {
    // Katalog bierzemy z nazwy aktywnej zakładki, jeśli wygląda na ścieżkę — dopóki API
    // nie ma okna wyboru katalogu, to najprostsza droga bez zgadywania.
    const tab = await ctx.workspace.getActiveTab().catch(() => null);
    const kandydat = tab?.title?.includes(path.sep) ? tab.title : null;
    if (!kandydat) {
      await ctx.notifications.show(
        `Katalog główny: ${katalogGlowny}. Zmień go, wpisując ścieżkę w polu "katalogGlowny" w ${await ctx.storage.path()}`,
        'warn'
      );
      return;
    }
    katalogGlowny = kandydat;
    await ctx.storage.set('katalogGlowny', katalogGlowny);
    await ctx.ui.refreshView(WIDOK);
    await odswiezWskaznik();
    await ctx.notifications.show(`Katalog główny: ${katalogGlowny}`);
  });

  await odswiezWskaznik();
  console.log('[pliki] drzewo gotowe, katalog główny:', katalogGlowny);
};

exports.deactivate = async function deactivate() {
  console.log('[pliki] zatrzymano');
};
