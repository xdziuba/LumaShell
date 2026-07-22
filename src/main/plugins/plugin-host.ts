/**
 * Zarządzanie oknem Plugin Hosta po stronie procesu głównego (Etap 6).
 *
 * Host to UKRYTE okno z sandbox:true, bez integracji Node — środowisko dla niezaufanego
 * kodu wtyczek (docs/architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).
 * Ten moduł tylko przenosi wiadomości; polityka (uprawnienia) jest w plugin-manager.
 */

import { join } from 'node:path';
import { BrowserWindow, ipcMain, session } from 'electron';

const TO_MAIN = 'plugin-host:to-main';
const TO_HOST = 'plugin-host:to-host';

/**
 * Osobna, nietrwała sesja hosta. Dwa powody: to na niej wieszamy blokadę sieci, a przy
 * okazji wtyczki nie dzielą ciasteczek ani magazynu z głównym oknem.
 */
const PARTITION = 'plugin-host';

let host: BrowserWindow | undefined;

/**
 * Zamyka hosta na sieć — na poziomie SESJI, nie polityki strony.
 *
 * CSP dokumentu blokuje `fetch`/XHR/WebSocket w samym dokumencie hosta (sprawdzone), ale
 * NIE obejmuje ruchu z Web Workerów: worker utworzony na stronie `file://` wychodzi do sieci
 * mimo `default-src 'none'` (też sprawdzone, na Electronie 43). Skoro wtyczka może utworzyć
 * workera, CSP nie jest granicą — jest nią dopiero `webRequest` w procesie głównym.
 *
 * Przepuszczamy wyłącznie to, z czego host żyje: własne pliki (`file://`) oraz serwer
 * deweloperski Vite, gdy pracujemy w trybie dev.
 */
function blokujSiec(): Electron.Session {
  const ses = session.fromPartition(PARTITION);
  const dev = process.env.ELECTRON_RENDERER_URL;

  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    if (url.startsWith('file://') || url.startsWith('devtools://') || url.startsWith('blob:') || url.startsWith('data:')) {
      callback({ cancel: false });
      return;
    }
    if (dev && (url.startsWith(dev) || url.startsWith(dev.replace('http://', 'ws://')))) {
      callback({ cancel: false });
      return;
    }
    console.warn('[plugins] zablokowano żądanie sieciowe hosta:', url.slice(0, 120));
    callback({ cancel: true });
  });

  return ses;
}

/** Tworzy (raz) ukryte okno hosta i podpina odbiór wiadomości od niego. */
export function createPluginHost(onMessage: (message: unknown) => void): BrowserWindow {
  if (host && !host.isDestroyed()) return host;

  host = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/plugin-host.js'),
      // Rdzeń izolacji D2: pełny sandbox, zero Node, izolacja kontekstu.
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      session: blokujSiec()
    }
  });

  // Wtyczka nie otwiera okien ani nie nawiguje hosta gdzie indziej — okno hosta ma przez
  // całe życie pokazywać dokładnie jedną, naszą stronę.
  host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  host.webContents.on('will-navigate', (event) => event.preventDefault());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void host.loadURL(`${rendererUrl}/plugin-host/index.html`);
  } else {
    void host.loadFile(join(__dirname, '../renderer/plugin-host/index.html'));
  }

  ipcMain.on(TO_MAIN, (event, message: unknown) => {
    // Przyjmujemy wyłącznie wiadomości z naszego okna hosta.
    if (event.sender === host?.webContents) onMessage(message);
  });

  return host;
}

/** Wysyła wiadomość do runtime hosta (np. załaduj wtyczkę, wywołaj komendę). */
export function sendToHost(message: unknown): void {
  if (host && !host.isDestroyed()) host.webContents.send(TO_HOST, message);
}
