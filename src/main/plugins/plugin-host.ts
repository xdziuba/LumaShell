/**
 * Zarządzanie oknem Plugin Hosta po stronie procesu głównego (Etap 6).
 *
 * Host to UKRYTE okno z sandbox:true, bez integracji Node — środowisko dla niezaufanego
 * kodu wtyczek (docs/architecture/10-decyzje.md#d2--izolacja-wtyczek-rpc-bez-node).
 * Ten moduł tylko przenosi wiadomości; polityka (uprawnienia) jest w plugin-manager.
 */

import { join } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';

const TO_MAIN = 'plugin-host:to-main';
const TO_HOST = 'plugin-host:to-host';

let host: BrowserWindow | undefined;

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
      contextIsolation: true
    }
  });

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
