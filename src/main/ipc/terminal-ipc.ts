/**
 * IPC terminala: tworzenie sesji PTY, przepływ danych, zmiana rozmiaru, sprzątanie.
 *
 * Każdy ładunek z renderera jest walidowany przed użyciem
 * (docs/security/01-model-procesow.md).
 */

import { randomUUID } from 'node:crypto';
import { ipcMain, type BrowserWindow } from 'electron';
import type { TerminalTransport } from '@core/transports/transport';
import { LocalPtyTransport } from '@services/pty/local-pty-transport';
import { discoverShells, type ShellDefinition } from '@services/pty/shell-detection';
import { SerialTransport, listSerialPorts } from '@services/serial/serial-transport';
import {
  parseTerminalCreate,
  parseTerminalDispose,
  parseTerminalResize,
  parseTerminalWrite
} from '@shared/schemas/ipc-validation';
import {
  IpcChannel,
  IpcEvent,
  type SessionSpec,
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
  transport: TerminalTransport;
  pending: Uint8Array[];
  timer: NodeJS.Timeout | undefined;
}

const sessions = new Map<string, Session>();

function flush(sessionId: string, window: BrowserWindow): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.timer = undefined;
  if (session.pending.length === 0) return;

  // Sklejenie porcji w jeden bufor: jeden komunikat IPC zamiast setek.
  const data = Buffer.concat(session.pending);
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

/**
 * Wykryte powłoki są zapamiętywane po pierwszym użyciu.
 *
 * Wykrywanie odpala `wsl.exe`, więc powtarzanie go przy każdej nowej sesji byłoby
 * marnotrawstwem (docs/architecture/05-wydajnosc.md).
 */
let shellCache: ShellDefinition[] | undefined;

async function getShells(): Promise<ShellDefinition[]> {
  shellCache ??= await discoverShells();
  return shellCache;
}

/** Zbudowanie transportu odpowiedniego dla żądanego rodzaju sesji. */
async function createTransport(
  sessionId: string,
  spec: SessionSpec,
  columns: number,
  rows: number
): Promise<{ transport: TerminalTransport; label: string }> {
  if (spec.kind === 'serial') {
    return {
      transport: new SerialTransport(sessionId, { path: spec.path, baudRate: spec.baudRate }),
      label: `${spec.path} @ ${spec.baudRate}`
    };
  }

  const shells = await getShells();
  // Identyfikator z renderera jest kluczem do listy wykrytych powłok, nigdy ścieżką.
  // Nieznany identyfikator schodzi na powłokę domyślną zamiast wywracać sesję.
  const shell = shells.find((candidate) => candidate.id === spec.shellId) ?? shells[0];
  if (!shell) throw new Error('Nie wykryto żadnej powłoki');

  return {
    transport: new LocalPtyTransport(sessionId, {
      shell: shell.path,
      args: shell.args,
      cwd: spec.cwd,
      columns,
      rows
    }),
    label: shell.label
  };
}

export function registerTerminalIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannel.ShellList, async () =>
    (await getShells()).map(({ id, label }) => ({ id, label }))
  );

  ipcMain.handle(IpcChannel.SerialListPorts, () => listSerialPorts());

  ipcMain.handle(IpcChannel.TerminalCreate, async (_event, payload): Promise<TerminalCreateResult> => {
    const { spec, columns, rows } = parseTerminalCreate(payload);
    const sessionId = randomUUID();
    const { transport, label } = await createTransport(sessionId, spec, columns, rows);

    sessions.set(sessionId, { transport, pending: [], timer: undefined });

    transport.onData((data) => {
      sessions.get(sessionId)?.pending.push(data);
      schedule(sessionId, window);
    });

    // Kod wyjścia jest pojęciem wyłącznie PTY — port szeregowy się zamyka, ale niczego
    // nie „kończy". Dlatego koniec sesji rozgłasza wspólny stan 'closed', a kod
    // dokłada tylko ten transport, który go ma.
    let exitCode: number | undefined;
    if (transport instanceof LocalPtyTransport) {
      transport.onExit((code) => {
        exitCode = code;
      });
    }

    transport.onStateChange((state) => {
      if (state !== 'closed') return;
      flush(sessionId, window);
      if (!window.isDestroyed()) {
        window.webContents.send(IpcEvent.TerminalExit, { sessionId, exitCode });
      }
      disposeSession(sessionId);
    });

    await transport.connect();
    return { sessionId, label };
  });

  ipcMain.handle(IpcChannel.TerminalWrite, async (_event, payload) => {
    const { sessionId, data } = parseTerminalWrite(payload);
    await sessions.get(sessionId)?.transport.write(data);
  });

  ipcMain.handle(IpcChannel.TerminalResize, async (_event, payload) => {
    const { sessionId, columns, rows } = parseTerminalResize(payload);
    // `resize` jest w kontrakcie opcjonalne — port szeregowy nie ma rozmiaru okna.
    await sessions.get(sessionId)?.transport.resize?.(columns, rows);
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
