/**
 * IPC okna: możliwości środowiska, ustawienia, profile, motywy oraz sterowanie oknem.
 *
 * Minimalizacja, maksymalizacja i zamykanie mają własne kanały — okno ma teraz własne
 * przyciski (kółka), nie natywne Window Controls Overlay. To świadoma rezygnacja ze Snap
 * Layouts na rzecz spójnego wyglądu (aktualizacja decyzji D1, docs/architecture/10-decyzje.md).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { logsDir, reportRendererError } from '../error-reporter';
import { detectCapabilities } from '../capabilities';
import { loadSettings, saveSettings } from '../settings-store';
import { deleteProfile, listProfiles, saveProfile } from '../profiles-store';
import { loadWorkspace, saveWorkspace } from '../workspace-store';
import {
  deleteCustomTheme,
  getThemeState,
  saveCustomTheme,
  selectTheme
} from '../themes-store';
import { parseTheme } from '@shared/schemas/theme-validation';
import { IpcChannel, IpcEvent } from '@shared/types/ipc';

export function registerWindowIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannel.AppCapabilities, () => detectCapabilities());

  // Sterowanie oknem obsługują teraz własne przyciski (kółka), nie natywne WCO — świadoma
  // rezygnacja ze Snap Layouts na rzecz spójnej estetyki (docs/architecture/10-decyzje.md).
  ipcMain.handle(IpcChannel.WindowMinimize, () => window.minimize());
  ipcMain.handle(IpcChannel.WindowMaximizeToggle, () => {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle(IpcChannel.WindowClose, () => window.close());
  ipcMain.handle(IpcChannel.WindowIsMaximized, () => window.isMaximized());

  // Renderer aktualizuje ikonę maksymalizacji po zmianie stanu okna (także przez Win+strzałki).
  const emitMaximized = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcEvent.WindowMaximizedChanged, window.isMaximized());
    }
  };
  window.on('maximize', emitMaximized);
  window.on('unmaximize', emitMaximized);

  ipcMain.handle(IpcChannel.SettingsGet, () => loadSettings());
  // Ładunek jest niezaufany — saveSettings przepuszcza go przez walidację i przycina
  // wartości do dozwolonych zakresów.
  ipcMain.handle(IpcChannel.SettingsSave, (_event, payload) => saveSettings(payload));

  ipcMain.handle(IpcChannel.ProfilesList, () => listProfiles());
  ipcMain.handle(IpcChannel.ProfilesSave, (_event, payload) => saveProfile(payload));
  ipcMain.handle(IpcChannel.ProfilesDelete, (_event, id) => deleteProfile(id));

  ipcMain.handle(IpcChannel.WorkspaceGet, () => loadWorkspace());
  ipcMain.handle(IpcChannel.WorkspaceSave, (_event, payload) => saveWorkspace(payload));

  // Nowości: próbujemy pobrać aktualny changelog z GitHuba, a gdy brak sieci/pliku —
  // wracamy do wersji dołączonej do aplikacji. Zawsze zwraca coś sensownego.
  ipcMain.handle(IpcChannel.AppWhatsNew, async (): Promise<unknown> => {
    const url = 'https://raw.githubusercontent.com/xdziuba/LumaShell/main/resources/whatsnew.json';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return await res.json();
    } catch {
      // offline albo pliku jeszcze nie ma w repo — fallback niżej
    }
    return JSON.parse(await readFile(join(app.getAppPath(), 'resources', 'whatsnew.json'), 'utf8'));
  });

  // Diagnostyka: otwarcie katalogu logów, zgłoszenie problemu i zapis błędu z renderera.
  ipcMain.handle(IpcChannel.AppOpenLogs, () => shell.openPath(logsDir()));
  ipcMain.handle(IpcChannel.AppReportProblem, () => {
    const body = encodeURIComponent(
      `**Opis problemu:**\n\n\n**Kroki do odtworzenia:**\n\n\n**Wersja:** ${app.getVersion()}\n**System:** ${process.platform} ${process.getSystemVersion?.() ?? ''}\n`
    );
    return shell.openExternal(`https://github.com/xdziuba/LumaShell/issues/new?body=${body}`);
  });
  ipcMain.handle(IpcChannel.AppReportError, (_event, message: unknown) => {
    if (typeof message === 'string') reportRendererError(message.slice(0, 8000));
  });

  ipcMain.handle(IpcChannel.ThemesGet, () => getThemeState());
  ipcMain.handle(IpcChannel.ThemeSelect, (_event, id) => selectTheme(id));
  ipcMain.handle(IpcChannel.ThemeSave, (_event, payload) => saveCustomTheme(payload));
  ipcMain.handle(IpcChannel.ThemeDelete, (_event, id) => deleteCustomTheme(id));

  // Import: wczytaj plik JSON, zwaliduj (dane niezaufane) i zapisz jako własny.
  ipcMain.handle(IpcChannel.ThemeImport, async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Motyw LumaShell', extensions: ['json'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const theme = parseTheme(JSON.parse(await readFile(result.filePaths[0]!, 'utf8')));
    return saveCustomTheme(theme);
  });

  // Eksport: zapisz wskazany motyw do pliku JSON.
  ipcMain.handle(IpcChannel.ThemeExport, async (_event, payload): Promise<boolean> => {
    const theme = parseTheme(payload);
    const result = await dialog.showSaveDialog(window, { defaultPath: `${theme.id}.json` });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, JSON.stringify(theme, null, 2), 'utf8');
    return true;
  });

  // Wybór tapety: wczytaj obraz i zwróć jako data URL (self-contained w motywie).
  ipcMain.handle(IpcChannel.ThemePickWallpaper, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Obraz', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0]!;
    const buffer = await readFile(path);
    // Zbyt duży obraz odrzucamy, żeby nie rozdąć themes.json.
    if (buffer.length > 4_000_000) throw new Error('Obraz za duży (max 4 MB)');
    const ext = path.split('.').pop()?.toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : (ext ?? 'png');
    return `data:image/${mime};base64,${buffer.toString('base64')}`;
  });
}
