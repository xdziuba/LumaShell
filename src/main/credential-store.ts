/**
 * Magazyn poświadczeń oparty na Electron `safeStorage`.
 *
 * Realizuje zasadę z docs/security/02-sekrety.md: hasła SSH i hasła kluczy prywatnych
 * NIE trafiają do plików konfiguracyjnych jawnym tekstem. `safeStorage` na Windows szyfruje
 * przez DPAPI (klucz związany z kontem użytkownika systemu).
 *
 * Zaszyfrowane bloby leżą w `credentials.json` (base64). Nawet po skopiowaniu pliku na inny
 * komputer nie da się ich odszyfrować bez tego konta Windows.
 */

import { rename, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';

type Blobs = Record<string, string>;

let cache: Blobs | undefined;

function filePath(): string {
  return join(app.getPath('userData'), 'credentials.json');
}

async function load(): Promise<Blobs> {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath(), 'utf8'));
    cache = typeof parsed === 'object' && parsed !== null ? (parsed as Blobs) : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(blobs: Blobs): Promise<void> {
  cache = blobs;
  const target = filePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(blobs, null, 2), 'utf8');
  await rename(temp, target);
}

export function isAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Szyfruje i zapisuje sekret pod danym identyfikatorem.
 *
 * Rzuca, gdy szyfrowanie jest niedostępne — lepiej odmówić zapisu niż zapisać sekret
 * jawnym tekstem.
 */
export async function setSecret(id: string, secret: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Szyfrowanie poświadczeń jest niedostępne na tym systemie');
  }
  const encrypted = safeStorage.encryptString(secret).toString('base64');
  await persist({ ...(await load()), [id]: encrypted });
}

/** Odczytuje i deszyfruje sekret; `undefined`, gdy nie ma go w magazynie. */
export async function getSecret(id: string): Promise<string | undefined> {
  const blob = (await load())[id];
  if (!blob) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch {
    // Blob z innego konta/systemu — nie da się odszyfrować.
    return undefined;
  }
}

export async function deleteSecret(id: string): Promise<void> {
  const blobs = { ...(await load()) };
  delete blobs[id];
  await persist(blobs);
}

/** Czy sekret istnieje — bez deszyfrowania. Do pokazania „hasło zapisane" w UI. */
export async function hasSecret(id: string): Promise<boolean> {
  return Boolean((await load())[id]);
}
