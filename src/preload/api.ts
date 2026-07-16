/**
 * Kształt API wystawianego rendererowi.
 *
 * To jedyne przejście renderera do zasobów. API jest wąskie i jawne — renderer nie
 * dostaje `ipcRenderer` ani niczego z Node.js (docs/security/01-model-procesow.md).
 */

import { ipcRenderer } from 'electron';
import type { SerialPortInfo } from '@core/transports/transport';
import type { LumaApi, Unsubscribe } from '@shared/types/api';
import type { TerminalSettings } from '@shared/types/settings';
import {
  IpcChannel,
  IpcEvent,
  type AppCapabilities,
  type SessionSpec,
  type ShellInfo,
  type TerminalCreateResult,
  type TerminalDataEvent,
  type TerminalExitEvent
} from '@shared/types/ipc';

/** Zwraca funkcję wypisującą nasłuch — inaczej React w trybie strict zdubluje handlery. */
function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

export const api: LumaApi = {
  getCapabilities: (): Promise<AppCapabilities> => ipcRenderer.invoke(IpcChannel.AppCapabilities),

  listShells: (): Promise<ShellInfo[]> => ipcRenderer.invoke(IpcChannel.ShellList),

  settings: {
    get: (): Promise<TerminalSettings> => ipcRenderer.invoke(IpcChannel.SettingsGet),
    save: (settings: TerminalSettings): Promise<TerminalSettings> =>
      ipcRenderer.invoke(IpcChannel.SettingsSave, settings)
  },

  serial: {
    listPorts: (): Promise<SerialPortInfo[]> => ipcRenderer.invoke(IpcChannel.SerialListPorts)
  },

  terminal: {
    create: (spec: SessionSpec, columns: number, rows: number): Promise<TerminalCreateResult> =>
      ipcRenderer.invoke(IpcChannel.TerminalCreate, { spec, columns, rows }),
    write: (sessionId: string, data: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.TerminalWrite, { sessionId, data }),
    resize: (sessionId: string, columns: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.TerminalResize, { sessionId, columns, rows }),
    dispose: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.TerminalDispose, { sessionId }),
    onData: (callback: (event: TerminalDataEvent) => void): Unsubscribe =>
      subscribe(IpcEvent.TerminalData, callback),
    onExit: (callback: (event: TerminalExitEvent) => void): Unsubscribe =>
      subscribe(IpcEvent.TerminalExit, callback)
  }
};
