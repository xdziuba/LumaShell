/**
 * Trwały magazyn profili połączeń.
 *
 * `profiles.json` w katalogu danych aplikacji. Bez sekretów — hasła i klucze należą do
 * magazynu poświadczeń systemu (docs/security/02-sekrety.md).
 */

import { rename, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { parseProfile, parseProfileList } from '@shared/schemas/profile-validation';
import type { Profile } from '@core/profiles/profile';

let cache: Profile[] | undefined;

function filePath(): string {
  return join(app.getPath('userData'), 'profiles.json');
}

async function persist(profiles: Profile[]): Promise<void> {
  cache = profiles;
  const target = filePath();
  const temp = `${target}.tmp`;
  // Zapis atomowy — jak w settings-store: plik tymczasowy, potem podmiana.
  await writeFile(temp, JSON.stringify(profiles, null, 2), 'utf8');
  await rename(temp, target);
}

export async function listProfiles(): Promise<Profile[]> {
  if (cache) return cache;
  try {
    cache = parseProfileList(JSON.parse(await readFile(filePath(), 'utf8')));
  } catch {
    cache = [];
  }
  return cache;
}

/** Wstawia lub nadpisuje profil (po id) i zwraca pełną listę po walidacji. */
export async function saveProfile(payload: unknown): Promise<Profile[]> {
  const profile = parseProfile(payload);
  const current = await listProfiles();
  const index = current.findIndex((p) => p.id === profile.id);
  const next = index === -1 ? [...current, profile] : current.map((p, i) => (i === index ? profile : p));
  await persist(next);
  return next;
}

export async function deleteProfile(id: unknown): Promise<Profile[]> {
  const current = await listProfiles();
  const next = current.filter((p) => p.id !== id);
  await persist(next);
  return next;
}
