/**
 * Kształt API wystawianego rendererowi.
 *
 * To jedyne przejście renderera do zasobów. API jest wąskie i jawne — renderer nie
 * dostaje `ipcRenderer` ani niczego z Node.js (docs/security/01-model-procesow.md).
 */

import { ipcRenderer } from 'electron';
import type { SerialPortInfo } from '@core/transports/transport';
import type { Profile } from '@core/profiles/profile';
import type { Theme } from '@core/theme/theme';
import type { LumaApi, Unsubscribe } from '@shared/types/api';
import type { TerminalSettings } from '@shared/types/settings';
import {
  IpcChannel,
  IpcEvent,
  type AppCapabilities,
  type HostVerifyRequest,
  type SessionSpec,
  type ShellInfo,
  type SftpEntry,
  type SshConnectRequest,
  type TerminalCreateResult,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type WorkspaceSnapshot
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

  profiles: {
    list: (): Promise<Profile[]> => ipcRenderer.invoke(IpcChannel.ProfilesList),
    save: (profile: Profile): Promise<Profile[]> =>
      ipcRenderer.invoke(IpcChannel.ProfilesSave, profile),
    delete: (id: string): Promise<Profile[]> => ipcRenderer.invoke(IpcChannel.ProfilesDelete, id)
  },

  themes: {
    get: (): Promise<{ themes: Theme[]; selectedId: string }> =>
      ipcRenderer.invoke(IpcChannel.ThemesGet),
    select: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannel.ThemeSelect, id),
    save: (theme: Theme): Promise<Theme[]> => ipcRenderer.invoke(IpcChannel.ThemeSave, theme),
    delete: (id: string): Promise<Theme[]> => ipcRenderer.invoke(IpcChannel.ThemeDelete, id),
    import: (): Promise<Theme[] | null> => ipcRenderer.invoke(IpcChannel.ThemeImport),
    export: (theme: Theme): Promise<boolean> => ipcRenderer.invoke(IpcChannel.ThemeExport, theme),
    pickWallpaper: (): Promise<string | null> => ipcRenderer.invoke(IpcChannel.ThemePickWallpaper)
  },

  workspace: {
    get: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke(IpcChannel.WorkspaceGet),
    save: (snapshot: WorkspaceSnapshot): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.WorkspaceSave, snapshot)
  },

  serial: {
    listPorts: (): Promise<SerialPortInfo[]> => ipcRenderer.invoke(IpcChannel.SerialListPorts)
  },

  ssh: {
    connect: (request: SshConnectRequest): Promise<{ connectionId: string; label: string }> =>
      ipcRenderer.invoke(IpcChannel.SshConnect, request),
    onHostVerify: (callback: (request: HostVerifyRequest) => void): Unsubscribe =>
      subscribe(IpcEvent.SshHostVerify, callback),
    respondHostVerify: (requestId: string, accepted: boolean): void => {
      ipcRenderer.send(IpcChannel.SshHostVerifyResponse, { requestId, accepted });
    }
  },

  sessionLog: {
    start: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.SessionLogStart, sessionId),
    stop: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.SessionLogStop, sessionId)
  },

  sftp: {
    realpath: (sessionId: string, path: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.SftpRealpath, sessionId, path),
    list: (sessionId: string, path: string): Promise<SftpEntry[]> =>
      ipcRenderer.invoke(IpcChannel.SftpList, sessionId, path),
    download: (sessionId: string, path: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.SftpDownload, sessionId, path),
    upload: (sessionId: string, dir: string): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.SftpUpload, sessionId, dir)
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
