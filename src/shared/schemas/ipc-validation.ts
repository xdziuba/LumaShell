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
  TerminalCreateRequest,
  TerminalDisposeRequest,
  TerminalResizeRequest,
  TerminalWriteRequest
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

  throw new IpcValidationError(`nieznany rodzaj sesji: ${String(kind)}`);
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
