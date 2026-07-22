/**
 * IPC terminala: tworzenie sesji PTY, przepływ danych, zmiana rozmiaru, sprzątanie.
 *
 * Każdy ładunek z renderera jest walidowany przed użyciem
 * (docs/security/01-model-procesow.md).
 */

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { createWriteStream, type WriteStream } from 'node:fs';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { TerminalTransport } from '@core/transports/transport';
import { LocalPtyTransport } from '@services/pty/local-pty-transport';
import { discoverShells, type ShellDefinition } from '@services/pty/shell-detection';
import { SerialTransport, listSerialPorts } from '@services/serial/serial-transport';
import { SshTransport } from '@services/ssh/ssh-transport';
import { createNetworkTransport } from '@services/net/network-transport';
import { createContainerTransport, listContainers } from '@services/container/container-exec';
import { createAiCliTransport, detectAiClis } from '@services/ai/ai-cli';
import { registerSftpIpc } from './sftp-ipc';
import { dropConnection, registerConnection, resolveOptions } from '../ssh/ssh-connections';
import { registerHostVerifyIpc } from '../ssh/host-verify';
import {
  parseSshConnect,
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
  /** Ustawione dla sesji SSH — deskryptor połączenia do sprzątnięcia przy zamknięciu. */
  connectionId?: string;
  /** Aktywny zapis danych sesji do pliku (włączany na żądanie). */
  logStream?: WriteStream;
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
  session.logStream?.end();
  void session.transport.disconnect();
  // Sekrety SSH znikają z pamięci wraz z deskryptorem połączenia.
  if (session.connectionId) dropConnection(session.connectionId);
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
  rows: number,
  window: BrowserWindow
): Promise<{ transport: TerminalTransport; label: string }> {
  if (spec.kind === 'serial') {
    return {
      transport: new SerialTransport(sessionId, {
        path: spec.path,
        baudRate: spec.baudRate,
        dataBits: spec.dataBits,
        stopBits: spec.stopBits,
        parity: spec.parity,
        rtscts: spec.rtscts
      }),
      label: `${spec.path} @ ${spec.baudRate}`
    };
  }

  if (spec.kind === 'ssh') {
    const options = await resolveOptions(spec.connectionId, window, columns, rows);
    return { transport: new SshTransport(sessionId, options), label: spec.label };
  }

  if (spec.kind === 'network') {
    return {
      transport: createNetworkTransport(sessionId, {
        protocol: spec.protocol,
        host: spec.host,
        port: spec.port,
        path: spec.path,
        insecureTls: spec.insecureTls
      }),
      label: spec.label
    };
  }

  if (spec.kind === 'container') {
    return {
      transport: createContainerTransport(sessionId, {
        runtime: spec.runtime,
        target: spec.target,
        shell: spec.shell,
        namespace: spec.namespace,
        columns,
        rows
      }),
      label: spec.label
    };
  }

  if (spec.kind === 'ai-cli') {
    return {
      transport: createAiCliTransport(sessionId, { tool: spec.tool, cwd: spec.cwd, columns, rows }),
      label: zEtykietaKatalogu(spec.label, spec.cwd)
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
    label: zEtykietaKatalogu(shell.label, spec.cwd)
  };
}

/**
 * Etykieta sesji wzbogacona o katalog roboczy, gdy został wskazany.
 *
 * Nazwa sesji z procesu głównego jest ostateczna — nadpisuje tę ustawioną optymistycznie
 * w rendererze, więc bez tego zakładka otwarta „w folderze" wracała do samej nazwy powłoki
 * w chwili zestawienia sesji.
 */
function zEtykietaKatalogu(label: string, cwd: string | undefined): string {
  if (!cwd) return label;
  const nazwa = basename(cwd);
  return nazwa ? `${label} — ${nazwa}` : label;
}

export function registerTerminalIpc(window: BrowserWindow): void {
  registerHostVerifyIpc();

  ipcMain.handle(IpcChannel.ShellList, async () =>
    (await getShells()).map(({ id, label }) => ({ id, label }))
  );

  ipcMain.handle(IpcChannel.SerialListPorts, () => listSerialPorts());

  // Wykrywanie kontenerów/podów jest leniwe i odporne — puste, gdy brak docker/kubectl.
  ipcMain.handle(IpcChannel.ContainerList, () => listContainers());

  // Wykrywanie CLI AI (codex/claude) w PATH — nic nie uruchamia, tylko sprawdza dostępność.
  ipcMain.handle(IpcChannel.AiDetectClis, () => detectAiClis());

  // Rejestracja połączenia SSH: sekrety zostają w procesie głównym, renderer dostaje
  // tylko connectionId, którym potem otwiera sesję.
  ipcMain.handle(IpcChannel.SshConnect, (_event, payload) => registerConnection(parseSshConnect(payload)));

  /** Transport SSH danej sesji — wspólny punkt wejścia dla operacji SFTP. */
  const sshSession = (sessionId: unknown): SshTransport => {
    if (typeof sessionId !== 'string') throw new Error('Brak identyfikatora sesji');
    const transport = sessions.get(sessionId)?.transport;
    if (!(transport instanceof SshTransport)) throw new Error('Sesja nie jest połączeniem SSH');
    return transport;
  };

  // --- SFTP: tylko dla sesji SSH; same operacje mieszkają w sftp-ipc ---
  registerSftpIpc(window, sshSession);

  // --- Logowanie danych sesji do pliku (dowolna sesja) ---
  ipcMain.handle(IpcChannel.SessionLogStart, async (_e, sessionId): Promise<boolean> => {
    if (typeof sessionId !== 'string') return false;
    const session = sessions.get(sessionId);
    if (!session || session.logStream) return false;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = await dialog.showSaveDialog(window, { defaultPath: `lumashell-${stamp}.log` });
    if (result.canceled || !result.filePath) return false;
    session.logStream = createWriteStream(result.filePath, { flags: 'a' });
    return true;
  });

  ipcMain.handle(IpcChannel.SessionLogStop, (_e, sessionId): boolean => {
    if (typeof sessionId !== 'string') return false;
    const session = sessions.get(sessionId);
    if (!session?.logStream) return false;
    session.logStream.end();
    session.logStream = undefined;
    return true;
  });

  ipcMain.handle(IpcChannel.TerminalCreate, async (_event, payload): Promise<TerminalCreateResult> => {
    const { spec, columns, rows } = parseTerminalCreate(payload);
    const sessionId = randomUUID();
    const { transport, label } = await createTransport(sessionId, spec, columns, rows, window);

    sessions.set(sessionId, {
      transport,
      pending: [],
      timer: undefined,
      connectionId: spec.kind === 'ssh' ? spec.connectionId : undefined
    });

    transport.onData((data) => {
      const session = sessions.get(sessionId);
      session?.pending.push(data);
      // Zapis do pliku surowych bajtów sesji — dokładnie tego, co przyszło z transportu.
      session?.logStream?.write(Buffer.from(data));
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
