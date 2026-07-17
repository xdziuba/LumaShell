/**
 * Prośba o weryfikację klucza hosta: round-trip main → renderer → main.
 *
 * W trakcie handshake'u SSH proces główny pyta renderer, czy zaufać kluczowi. Renderer
 * pokazuje dialog i odsyła decyzję po `connectionId` żądania.
 */

import { randomUUID } from 'node:crypto';
import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel, IpcEvent, type HostVerifyRequest } from '@shared/types/ipc';

interface Pending {
  resolve: (accepted: boolean) => void;
}

const pending = new Map<string, Pending>();

/** Rejestruje jednorazowy odbiornik odpowiedzi z renderera. Wywołać raz przy starcie. */
export function registerHostVerifyIpc(): void {
  ipcMain.on(IpcChannel.SshHostVerifyResponse, (_event, payload: unknown) => {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const requestId = record['requestId'];
    const accepted = record['accepted'];
    if (typeof requestId !== 'string') return;
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    entry.resolve(accepted === true);
  });
}

/**
 * Wysyła prośbę do renderera i czeka na decyzję.
 *
 * Brak odpowiedzi w 2 minuty traktujemy jako odmowę — lepiej nie łączyć się niż wisieć
 * w nieskończoność na niezweryfikowanym hoście.
 */
export function requestHostVerification(
  window: BrowserWindow,
  info: Omit<HostVerifyRequest, 'requestId'>
): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(false);
  const requestId = randomUUID();

  return new Promise<boolean>((resolve) => {
    const finish = (accepted: boolean): void => {
      clearTimeout(timer);
      resolve(accepted);
    };
    const timer = setTimeout(() => {
      pending.delete(requestId);
      finish(false);
    }, 120_000);

    pending.set(requestId, { resolve: finish });
    window.webContents.send(IpcEvent.SshHostVerify, { requestId, ...info } satisfies HostVerifyRequest);
  });
}
