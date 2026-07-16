/**
 * Walidacja ładunków IPC.
 *
 * Proces główny traktuje każdy komunikat z renderera jako niezaufany
 * (docs/security/01-model-procesow.md). Ręczne strażniki zamiast zewnętrznej
 * biblioteki — zgodnie z zasadą braku ciężkich zależności tam, gdzie nie są
 * potrzebne (docs/architecture/05-wydajnosc.md).
 */

import type {
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

export function parseTerminalCreate(payload: unknown): TerminalCreateRequest {
  const source = asRecord(payload);
  return {
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
