/**
 * Tworzenie i konfiguracja okien.
 *
 * Realizuje decyzję D1: własna rama okna + systemowe rozmycie tła, z degradacją
 * na systemach bez obsługi acrylicu (docs/architecture/10-decyzje.md).
 */

import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';
import { detectCapabilities } from './capabilities';

/** Tło przy wyłączonym acrylicu — jednolite, nigdy przezroczyste. */
const OPAQUE_BACKGROUND = '#07110D';
/** Musi odpowiadać --titlebar-height w src/renderer/themes/_tokens.scss. */
const TITLEBAR_HEIGHT = 38;

export function createMainWindow(): BrowserWindow {
  const capabilities = detectCapabilities();

  const window = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 620,
    minHeight: 380,
    show: false,
    // `titleBarStyle: 'hidden'` + `titleBarOverlay` zamiast `frame: false`.
    //
    // Przy `frame: false` przyciski okna są zwykłymi elementami HTML, więc Windows nie
    // wie, gdzie jest przycisk maksymalizacji, i Snap Layouts nie działa. Window Controls
    // Overlay daje natywne przyciski (a z nimi Snap Layouts, poprawny hover i
    // dostępność), zostawiając nam pełną kontrolę nad resztą paska.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // Zerowa alfa — acrylic przebija także pod przyciskami. Bez rozmycia strip
      // przycisków musi mieć kolor panelu, inaczej byłby przezroczysty na pulpit.
      color: capabilities.acrylic ? '#00000000' : '#0B1913',
      symbolColor: '#8CB8A3',
      height: TITLEBAR_HEIGHT
    },
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

  return window;
}
