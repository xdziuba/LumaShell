/**
 * Walidacja ładunków IPC.
 *
 * Proces główny traktuje każdy komunikat z renderera jako niezaufany
 * (docs/security/01-model-procesow.md). Ręczne strażniki zamiast zewnętrznej
 * biblioteki — zgodnie z zasadą braku ciężkich zależności tam, gdzie nie są
 * potrzebne (docs/architecture/05-wydajnosc.md).
 */

import type {
  SessionSpec,
  SshConnectRequest,
  StoredPane,
  TerminalCreateRequest,
  TerminalDisposeRequest,
  TerminalResizeRequest,
  TerminalWriteRequest,
  WorkspaceSnapshot
} from '@shared/types/ipc';

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(`Nieprawidłowy ładunek IPC: ${message}`);
    this.name = 'IpcValidationError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcValidationError('oczekiwano obiektu');
  }
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string, maxLength: number): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new IpcValidationError(`pole "${key}" musi być tekstem`);
  }
  if (value.length > maxLength) {
    throw new IpcValidationError(`pole "${key}" przekracza ${maxLength} znaków`);
  }
  return value;
}

/** Wymiary terminala ograniczone z góry, żeby renderer nie zamówił absurdalnego PTY. */
function requireDimension(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2000) {
    throw new IpcValidationError(`pole "${key}" musi być liczbą całkowitą z zakresu 1–2000`);
  }
  return value;
}

const MAX_SESSION_ID = 64;
/** Limit pojedynczego zapisu — zabezpieczenie przed zalaniem PTY jednym komunikatem. */
const MAX_WRITE_LENGTH = 1_000_000;

/** Ścieżki portów akceptujemy wyłącznie w postaci COM<n> — renderer nie wskaże pliku. */
const COM_PATH = /^COM\d{1,3}$/i;

/** Wartości spoza tej listy to niemal zawsze błąd; UART nie jest polem do eksperymentów. */
const ALLOWED_BAUD_RATES = new Set([
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600
]);

function parseSessionSpec(value: unknown): SessionSpec {
  const source = asRecord(value);
  const kind = source['kind'];

  if (kind === 'pty') {
    const spec: { kind: 'pty'; shellId?: string; cwd?: string } = { kind: 'pty' };
    // Identyfikator jest odsyłany do listy wykrytych powłok, więc renderer nie może
    // podać dowolnej ścieżki do uruchomienia — to zwykły klucz, nie polecenie.
    if (source['shellId'] !== undefined) spec.shellId = requireString(source, 'shellId', 64);
    // cwd to katalog startowy powłoki. To pełna ścieżka na maszynie użytkownika —
    // ograniczamy tylko długość; istnienie katalogu weryfikuje dopiero PTY.
    if (source['cwd'] !== undefined) spec.cwd = requireString(source, 'cwd', 512);
    return spec;
  }

  if (kind === 'serial') {
    const path = requireString(source, 'path', 16);
    if (!COM_PATH.test(path)) {
      throw new IpcValidationError(`"path" musi mieć postać COM<n>, otrzymano "${path}"`);
    }
    const baudRate = source['baudRate'];
    if (typeof baudRate !== 'number' || !ALLOWED_BAUD_RATES.has(baudRate)) {
      throw new IpcValidationError(`"baudRate" spoza dozwolonych wartości: ${String(baudRate)}`);
    }
    return { kind: 'serial', path, baudRate };
  }

  if (kind === 'ssh') {
    // connectionId to klucz deskryptora w procesie głównym; sekretów tu nie ma.
    return {
      kind: 'ssh',
      connectionId: requireString(source, 'connectionId', 64),
      label: requireString(source, 'label', 120)
    };
  }

  throw new IpcValidationError(`nieznany rodzaj sesji: ${String(kind)}`);
}

const SSH_AUTH = new Set(['password', 'key', 'agent']);

function requirePort(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new IpcValidationError(`${key} poza zakresem 1–65535`);
  }
  return value;
}

/** Wspólna walidacja pól uwierzytelniania (dla hosta docelowego i jump hosta). */
function parseAuthFields(source: Record<string, unknown>): {
  auth: SshConnectRequest['auth'];
  password?: string;
  keyPath?: string;
  passphrase?: string;
} {
  const auth = source['auth'];
  if (typeof auth !== 'string' || !SSH_AUTH.has(auth)) {
    throw new IpcValidationError(`nieznana metoda uwierzytelniania: ${String(auth)}`);
  }
  const out: { auth: SshConnectRequest['auth']; password?: string; keyPath?: string; passphrase?: string } = {
    auth: auth as SshConnectRequest['auth']
  };
  if (source['password'] !== undefined) out.password = requireString(source, 'password', 1024);
  if (source['keyPath'] !== undefined) out.keyPath = requireString(source, 'keyPath', 512);
  if (source['passphrase'] !== undefined) out.passphrase = requireString(source, 'passphrase', 1024);
  return out;
}

/** Waliduje żądanie połączenia SSH. Sekrety są ograniczane długością, nigdy logowane. */
export function parseSshConnect(payload: unknown): SshConnectRequest {
  const source = asRecord(payload);
  const request: SshConnectRequest = {
    host: requireString(source, 'host', 255),
    port: requirePort(source, 'port'),
    username: requireString(source, 'username', 128),
    ...parseAuthFields(source)
  };

  if (source['jump'] !== undefined) {
    const jump = asRecord(source['jump']);
    request.jump = {
      host: requireString(jump, 'host', 255),
      port: requirePort(jump, 'port'),
      username: requireString(jump, 'username', 128),
      ...parseAuthFields(jump)
    };
  }

  if (Array.isArray(source['localForwards'])) {
    request.localForwards = source['localForwards'].map((raw) => {
      const f = asRecord(raw);
      return {
        localPort: requirePort(f, 'localPort'),
        destHost: requireString(f, 'destHost', 255),
        destPort: requirePort(f, 'destPort')
      };
    });
  }

  return request;
}

export function parseTerminalCreate(payload: unknown): TerminalCreateRequest {
  const source = asRecord(payload);
  return {
    spec: parseSessionSpec(source['spec']),
    columns: requireDimension(source, 'columns'),
    rows: requireDimension(source, 'rows')
  };
}

export function parseTerminalWrite(payload: unknown): TerminalWriteRequest {
  const source = asRecord(payload);
  return {
    sessionId: requireString(source, 'sessionId', MAX_SESSION_ID),
    data: requireString(source, 'data', MAX_WRITE_LENGTH)
  };
}

export function parseTerminalResize(payload: unknown): TerminalResizeRequest {
  const source = asRecord(payload);
  return {
    sessionId: requireString(source, 'sessionId', MAX_SESSION_ID),
    columns: requireDimension(source, 'columns'),
    rows: requireDimension(source, 'rows')
  };
}

export function parseTerminalDispose(payload: unknown): TerminalDisposeRequest {
  const source = asRecord(payload);
  return { sessionId: requireString(source, 'sessionId', MAX_SESSION_ID) };
}

/** Waliduje drzewo paneli z niezaufanego JSON. Rzuca przy błędzie struktury. */
function parseStoredPane(value: unknown, depth = 0): StoredPane {
  // Ogranicznik głębokości chroni przed spreparowanym, głęboko zagnieżdżonym drzewem.
  if (depth > 32) throw new IpcValidationError('drzewo paneli zbyt głębokie');
  const source = asRecord(value);

  if (source['kind'] === 'leaf') {
    return {
      kind: 'leaf',
      spec: parseSessionSpec(source['spec']),
      label: requireString(source, 'label', 120)
    };
  }
  if (source['kind'] === 'split') {
    const direction = source['direction'];
    if (direction !== 'row' && direction !== 'column') {
      throw new IpcValidationError(`zły kierunek splitu: ${String(direction)}`);
    }
    const ratio = source['ratio'];
    return {
      kind: 'split',
      direction,
      ratio: typeof ratio === 'number' && ratio > 0 && ratio < 1 ? ratio : 0.5,
      a: parseStoredPane(source['a'], depth + 1),
      b: parseStoredPane(source['b'], depth + 1)
    };
  }
  throw new IpcValidationError(`nieznany rodzaj panelu: ${String(source['kind'])}`);
}

/** Przycina drzewo do liści powłok, zwijając osierocone splity. `null` = całość odpadła. */
function pruneSerial(node: StoredPane): StoredPane | null {
  if (node.kind === 'leaf') return node.spec.kind === 'pty' ? node : null;
  const a = pruneSerial(node.a);
  const b = pruneSerial(node.b);
  if (a && b) return { ...node, a, b };
  return a ?? b;
}

/** Liczba liści w drzewie — do przycięcia zapisanego indeksu aktywnego liścia. */
function countLeaves(node: StoredPane): number {
  return node.kind === 'leaf' ? 1 : countLeaves(node.a) + countLeaves(node.b);
}

/**
 * Waliduje snapshot workspace'u.
 *
 * Zachowuje **wyłącznie liście powłok** — porty COM są przycinane z drzewa, bo nie wolno
 * ich auto-otwierać (patrz WorkspaceSnapshot). Uszkodzone zakładki są pomijane, nie
 * wywracają całości. Nigdy nie rzuca: zły plik daje pusty workspace.
 */
export function parseWorkspaceSnapshot(payload: unknown): WorkspaceSnapshot {
  let source: Record<string, unknown>;
  try {
    source = asRecord(payload);
  } catch {
    return { tabs: [], activeIndex: 0 };
  }

  const rawTabs = Array.isArray(source['tabs']) ? source['tabs'] : [];
  const tabs: WorkspaceSnapshot['tabs'] = [];
  for (const raw of rawTabs) {
    try {
      const record = asRecord(raw);
      const root = pruneSerial(parseStoredPane(record['root']));
      if (!root) continue; // cała zakładka była portami COM

      const rawLeafIndex = record['activeLeafIndex'];
      const activeLeafIndex =
        typeof rawLeafIndex === 'number' && Number.isInteger(rawLeafIndex) && rawLeafIndex >= 0
          ? Math.min(rawLeafIndex, countLeaves(root) - 1)
          : 0;
      tabs.push({ root, activeLeafIndex });
    } catch {
      // pomiń uszkodzoną zakładkę
    }
  }

  const rawIndex = source['activeIndex'];
  const activeIndex =
    typeof rawIndex === 'number' && Number.isInteger(rawIndex) && rawIndex >= 0
      ? Math.min(rawIndex, Math.max(0, tabs.length - 1))
      : 0;

  return { tabs, activeIndex };
}
