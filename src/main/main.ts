/**
 * Punkt wejścia procesu głównego.
 *
 * Kolejność startu jest celowa: okno i minimalna konfiguracja najpierw, reszta później
 * (docs/architecture/05-wydajnosc.md).
 */

import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window-manager';
import { registerWindowIpc } from './ipc/window-ipc';
import { disposeAllSessions, registerTerminalIpc } from './ipc/terminal-ipc';
import { registerAiIpc } from './ipc/ai-ipc';
import { initPlugins } from './plugins/plugin-manager';
import { zatrzymajWszystkie } from './plugins/ext-host-supervisor';
import { initAutoUpdater } from './updater/auto-updater';
import { initErrorReporter } from './error-reporter';
import { ensureUserDirs } from './user-dirs';
import { obsluzSchemat, zarejestrujSchemat } from './plugins/plugin-webview';

// Handlery błędów jak najwcześniej — żeby złapać także wyjątki podczas startu.
initErrorReporter();

// Schemat widoków wtyczek MUSI być zarejestrowany przed gotowością aplikacji — Chromium
// czyta listę uprzywilejowanych schematów raz, przy starcie.
zarejestrujSchemat();

/** Znacznik do pomiaru czasu startu — raportowany po pokazaniu okna. */
const startedAt = Date.now();

function bootstrap(): void {
  const window = createMainWindow();
  registerWindowIpc(window);
  registerTerminalIpc(window);
  registerAiIpc(window);

  window.once('ready-to-show', () => {
    console.log(`[start] okno gotowe po ${Date.now() - startedAt} ms`);
    // Wtyczki ładowane PO pokazaniu okna — nie opóźniają startu
    // (docs/architecture/05-wydajnosc.md). Host to osobne, ukryte okno.
    void initPlugins(window);
    // Sprawdzenie aktualizacji — tylko w spakowanej wersji, z własną zwłoką.
    initAutoUpdater(window);
  });
}

app.whenReady().then(() => {
  // Katalogi użytkownika przed czymkolwiek innym: skan wtyczek i lista motywów zakładają,
  // że istnieją, a przy pierwszym uruchomieniu ich nie ma.
  ensureUserDirs();
  obsluzSchemat();
  bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  });
});

app.on('window-all-closed', () => {
  disposeAllSessions();
  zatrzymajWszystkie();
  if (process.platform !== 'darwin') app.quit();
});

// Ani powłoki, ani procesy wtyczek nie mogą przeżyć aplikacji — nawet przy nagłym zamknięciu.
app.on('before-quit', () => {
  disposeAllSessions();
  zatrzymajWszystkie();
});
