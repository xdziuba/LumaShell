/**
 * IPC okna: możliwości środowiska.
 *
 * Minimalizacja, maksymalizacja i zamykanie okna nie mają tu swoich kanałów —
 * obsługują je natywne przyciski Window Controls Overlay, dzięki czemu działa
 * Snap Layouts (docs/architecture/10-decyzje.md).
 */

import { ipcMain } from 'electron';
import { detectCapabilities } from '../capabilities';
import { IpcChannel } from '@shared/types/ipc';

export function registerWindowIpc(): void {
  ipcMain.handle(IpcChannel.AppCapabilities, () => detectCapabilities());
}
