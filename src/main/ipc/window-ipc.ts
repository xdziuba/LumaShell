/**
 * IPC okna: możliwości środowiska.
 *
 * Minimalizacja, maksymalizacja i zamykanie okna nie mają tu swoich kanałów —
 * obsługują je natywne przyciski Window Controls Overlay, dzięki czemu działa
 * Snap Layouts (docs/architecture/10-decyzje.md).
 */

import { ipcMain } from 'electron';
import { detectCapabilities } from '../capabilities';
import { loadSettings, saveSettings } from '../settings-store';
import { deleteProfile, listProfiles, saveProfile } from '../profiles-store';
import { IpcChannel } from '@shared/types/ipc';

export function registerWindowIpc(): void {
  ipcMain.handle(IpcChannel.AppCapabilities, () => detectCapabilities());

  ipcMain.handle(IpcChannel.SettingsGet, () => loadSettings());
  // Ładunek jest niezaufany — saveSettings przepuszcza go przez walidację i przycina
  // wartości do dozwolonych zakresów.
  ipcMain.handle(IpcChannel.SettingsSave, (_event, payload) => saveSettings(payload));

  ipcMain.handle(IpcChannel.ProfilesList, () => listProfiles());
  ipcMain.handle(IpcChannel.ProfilesSave, (_event, payload) => saveProfile(payload));
  ipcMain.handle(IpcChannel.ProfilesDelete, (_event, id) => deleteProfile(id));
}
