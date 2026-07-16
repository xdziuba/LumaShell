/**
 * Tworzenie i konfiguracja okien.
 *
 * Realizuje decyzję D1: własna rama okna + systemowe rozmycie tła, z degradacją
 * na systemach bez obsługi acrylicu (docs/architecture/10-decyzje.md).
 */

import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';
import { detectCapabilities } from './capabilities';
import { IpcEvent } from '@shared/types/ipc';

/** Tło przy wyłączonym acrylicu — jednolite, nigdy przezroczyste. */
const OPAQUE_BACKGROUND = '#07110D';

export function createMainWindow(): BrowserWindow {
  const capabilities = detectCapabilities();

  const window = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 620,
    minHeight: 380,
    show: false,
    frame: false,
    // Zerowa alfa tylko wtedy, gdy system faktycznie dorysuje rozmycie.
    // Bez acrylicu zerowa alfa dałaby okno przezroczyste na ostry pulpit —
    // efekt gorszy niż jego brak.
    backgroundColor: capabilities.acrylic ? '#00000000' : OPAQUE_BACKGROUND,
    ...(capabilities.acrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.once('ready-to-show', () => window.show());

  // W trybie deweloperskim electron-vite podaje adres serwera z HMR;
  // w produkcji ładowany jest zbudowany plik.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Linki zewnętrzne otwierają się w przeglądarce, nigdy w oknie aplikacji.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const emitMaximized = (): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcEvent.WindowMaximizedChanged, window.isMaximized());
  };
  window.on('maximize', emitMaximized);
  window.on('unmaximize', emitMaximized);

  return window;
}
