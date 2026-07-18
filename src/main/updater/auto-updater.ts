/**
 * Automatyczne aktualizacje przez GitHub Releases (Etap 8).
 *
 * Działa WYŁĄCZNIE w spakowanej aplikacji (`app.isPackaged`) — w trybie deweloperskim
 * electron-updater nie ma pliku app-update.yml i tak by się wyłożył. Sprawdzenie odpala się
 * po starcie, pobiera aktualizację w tle i proponuje restart, gdy gotowa.
 *
 * Do PEŁNEGO działania potrzeba: publikowanych wydań na GitHubie (electron-builder --publish)
 * oraz — zalecane — podpisu kodu, inaczej Windows blokuje ciche aktualizacje. Provider bierze
 * się z app-update.yml dołączonego przez electron-builder (sekcja `publish` w konfiguracji).
 */

import { app, dialog, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export function initAutoUpdater(window: BrowserWindow): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    if (window.isDestroyed()) return;
    void dialog
      .showMessageBox(window, {
        type: 'info',
        buttons: ['Uruchom ponownie teraz', 'Później'],
        defaultId: 0,
        cancelId: 1,
        title: 'Aktualizacja gotowa',
        message: `Pobrano LumaShell ${info.version}.`,
        detail: 'Uruchom ponownie, aby zainstalować aktualizację. W przeciwnym razie zainstaluje się przy zamknięciu.'
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
      });
  });

  // Błędy aktualizacji nie mogą wywrócić aplikacji — logujemy i milczymy dla użytkownika.
  autoUpdater.on('error', (error) => {
    console.warn('[updater] błąd aktualizacji:', error?.message ?? error);
  });

  // Krótka zwłoka, żeby nie konkurować z uruchamianiem UI.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.warn('[updater] sprawdzenie nieudane:', (error as Error)?.message);
    });
  }, 4000);
}
