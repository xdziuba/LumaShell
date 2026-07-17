/**
 * Walidacja profili połączeń.
 *
 * Używana przy odczycie pliku (mógł zostać ręcznie popsuty) i przy zapisie z renderera
 * (ładunek IPC jest niezaufany — docs/security/01-model-procesow.md).
 */

import type { Profile } from '@core/profiles/profile';

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(`Nieprawidłowy profil: ${message}`);
    this.name = 'ProfileValidationError';
  }
}

const ALLOWED_BAUD_RATES = new Set([
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600
]);
const COM_PATH = /^COM\d{1,3}$/i;

function str(source: Record<string, unknown>, key: string, max: number): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new ProfileValidationError(`pole "${key}" musi być niepustym tekstem do ${max} znaków`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProfileValidationError('oczekiwano obiektu');
  }
  return value as Record<string, unknown>;
}

/** Waliduje jeden profil. Rzuca przy błędzie — wołający decyduje, czy pominąć czy przerwać. */
export function parseProfile(payload: unknown): Profile {
  const source = record(payload);
  const target = record(source['target']);
  const kind = target['kind'];

  if (kind === 'pty') {
    const t: Profile['target'] = { kind: 'pty' };
    if (target['shellId'] !== undefined) t.shellId = str(target, 'shellId', 64);
    if (target['cwd'] !== undefined) t.cwd = str(target, 'cwd', 512);
    return { id: str(source, 'id', 64), name: str(source, 'name', 80), target: t };
  }

  if (kind === 'serial') {
    const path = str(target, 'path', 16);
    if (!COM_PATH.test(path)) throw new ProfileValidationError(`"path" musi mieć postać COM<n>`);
    const baudRate = target['baudRate'];
    if (typeof baudRate !== 'number' || !ALLOWED_BAUD_RATES.has(baudRate)) {
      throw new ProfileValidationError(`niedozwolony baudRate: ${String(baudRate)}`);
    }
    return {
      id: str(source, 'id', 64),
      name: str(source, 'name', 80),
      target: { kind: 'serial', path, baudRate }
    };
  }

  throw new ProfileValidationError(`nieznany rodzaj celu: ${String(kind)}`);
}

/**
 * Waliduje listę profili, **pomijając** te uszkodzone.
 *
 * Jeden zepsuty wpis w pliku nie może wywalić całej listy — reszta profili musi się
 * wczytać. Odrzucone wpisy trafiają do konsoli, nie do wyjątku.
 */
export function parseProfileList(payload: unknown): Profile[] {
  if (!Array.isArray(payload)) return [];
  const profiles: Profile[] = [];
  for (const item of payload) {
    try {
      profiles.push(parseProfile(item));
    } catch (error) {
      console.warn('[profiles] pominięto uszkodzony profil:', (error as Error).message);
    }
  }
  return profiles;
}
