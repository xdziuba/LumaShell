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
import { initAutoUpdater } from './updater/auto-updater';
import { initErrorReporter } from './error-reporter';

// Handlery błędów jak najwcześniej — żeby złapać także wyjątki podczas startu.
initErrorReporter();

/** Znacznik do pomiaru czasu startu — raportowany po pokazaniu okna. */
const startedAt = Date.now();

function bootstrap(): void {
  const window = createMainWindow();
  registerWindowIpc(window);
  registerTerminalIpc(window);
  registerAiIpc();

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
  bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  });
});

app.on('window-all-closed', () => {
  disposeAllSessions();
  if (process.platform !== 'darwin') app.quit();
});

// Sieć powłok nie może przeżyć aplikacji nawet przy nagłym zamknięciu.
app.on('before-quit', disposeAllSessions);
