/**
 * IPC okna: możliwości środowiska.
 *
 * Minimalizacja, maksymalizacja i zamykanie okna nie mają tu swoich kanałów —
 * obsługują je natywne przyciski Window Controls Overlay, dzięki czemu działa
 * Snap Layouts (docs/architecture/10-decyzje.md).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
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
import { IpcChannel } from '@shared/types/ipc';

export function registerWindowIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannel.AppCapabilities, () => detectCapabilities());

  ipcMain.handle(IpcChannel.SettingsGet, () => loadSettings());
  // Ładunek jest niezaufany — saveSettings przepuszcza go przez walidację i przycina
  // wartości do dozwolonych zakresów.
  ipcMain.handle(IpcChannel.SettingsSave, (_event, payload) => saveSettings(payload));

  ipcMain.handle(IpcChannel.ProfilesList, () => listProfiles());
  ipcMain.handle(IpcChannel.ProfilesSave, (_event, payload) => saveProfile(payload));
  ipcMain.handle(IpcChannel.ProfilesDelete, (_event, id) => deleteProfile(id));

  ipcMain.handle(IpcChannel.WorkspaceGet, () => loadWorkspace());
  ipcMain.handle(IpcChannel.WorkspaceSave, (_event, payload) => saveWorkspace(payload));

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
