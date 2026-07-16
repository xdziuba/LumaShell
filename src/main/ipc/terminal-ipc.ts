/**
 * IPC terminala: tworzenie sesji PTY, przepływ danych, zmiana rozmiaru, sprzątanie.
 *
 * Każdy ładunek z renderera jest walidowany przed użyciem
 * (docs/security/01-model-procesow.md).
 */

import { randomUUID } from 'node:crypto';
import { ipcMain, type BrowserWindow } from 'electron';
import { LocalPtyTransport } from '@services/pty/local-pty-transport';
import { detectDefaultShell } from '@services/pty/shell-detection';
import {
  parseTerminalCreate,
  parseTerminalDispose,
  parseTerminalResize,
  parseTerminalWrite
} from '@shared/schemas/ipc-validation';
import {
  IpcChannel,
  IpcEvent,
  type TerminalCreateResult
} from '@shared/types/ipc';

/**
 * Okno grupowania danych z PTY.
 *
 * Powłoka potrafi wypluć tysiące małych porcji na sekundę. Wysyłanie każdej osobnym
 * komunikatem IPC zabija wydajność przy intensywnym wyjściu, dlatego porcje są sklejane
 * i wysyłane raz na klatkę (docs/architecture/05-wydajnosc.md).
 */
const FLUSH_INTERVAL_MS = 16;

interface Session {
  transport: LocalPtyTransport;
  pending: string[];
  timer: NodeJS.Timeout | undefined;
}

const sessions = new Map<string, Session>();

function flush(sessionId: string, window: BrowserWindow): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.timer = undefined;
  if (session.pending.length === 0) return;

  const data = session.pending.join('');
  session.pending.length = 0;

  if (!window.isDestroyed()) {
    window.webContents.send(IpcEvent.TerminalData, { sessionId, data });
  }
}

function schedule(sessionId: string, window: BrowserWindow): void {
  const session = sessions.get(sessionId);
  if (!session || session.timer) return;
  session.timer = setTimeout(() => flush(sessionId, window), FLUSH_INTERVAL_MS);
}

function disposeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  void session.transport.disconnect();
  sessions.delete(sessionId);
}

export function registerTerminalIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannel.TerminalCreate, async (_event, payload): Promise<TerminalCreateResult> => {
    const { columns, rows } = parseTerminalCreate(payload);
    const shell = detectDefaultShell();
    const sessionId = randomUUID();

    const transport = new LocalPtyTransport(sessionId, {
      shell: shell.path,
      columns,
      rows
    });

    sessions.set(sessionId, { transport, pending: [], timer: undefined });

    transport.onData((data) => {
      sessions.get(sessionId)?.pending.push(data);
      schedule(sessionId, window);
    });

    transport.onExit((exitCode) => {
      flush(sessionId, window);
      if (!window.isDestroyed()) {
        window.webContents.send(IpcEvent.TerminalExit, { sessionId, exitCode });
      }
      disposeSession(sessionId);
    });

    await transport.connect();
    return { sessionId, shell: shell.label };
  });

  ipcMain.handle(IpcChannel.TerminalWrite, async (_event, payload) => {
    const { sessionId, data } = parseTerminalWrite(payload);
    await sessions.get(sessionId)?.transport.write(data);
  });

  ipcMain.handle(IpcChannel.TerminalResize, async (_event, payload) => {
    const { sessionId, columns, rows } = parseTerminalResize(payload);
    await sessions.get(sessionId)?.transport.resize(columns, rows);
  });

  ipcMain.handle(IpcChannel.TerminalDispose, async (_event, payload) => {
    const { sessionId } = parseTerminalDispose(payload);
    disposeSession(sessionId);
  });
}

/** Zamknięcie wszystkich PTY — inaczej procesy powłok przeżyją aplikację. */
export function disposeAllSessions(): void {
  for (const sessionId of [...sessions.keys()]) disposeSession(sessionId);
}
