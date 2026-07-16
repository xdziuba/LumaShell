/**
 * IPC okna: przyciski własnej ramy oraz możliwości środowiska.
 *
 * Konsekwencja decyzji D1 — przy `frame: false` sterowanie oknem musi zejść
 * do renderera (docs/architecture/10-decyzje.md).
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { detectCapabilities } from '../capabilities';
import { IpcChannel } from '@shared/types/ipc';

export function registerWindowIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannel.AppCapabilities, () => detectCapabilities());

  ipcMain.handle(IpcChannel.WindowMinimize, () => window.minimize());

  ipcMain.handle(IpcChannel.WindowToggleMaximize, () => {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });

  ipcMain.handle(IpcChannel.WindowClose, () => window.close());
}
