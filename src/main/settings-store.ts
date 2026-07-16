/**
 * Trwały zapis ustawień.
 *
 * Plik leży w katalogu danych aplikacji. Nie trafiają tu żadne sekrety — hasła i klucze
 * należą do magazynu poświadczeń systemu (docs/security/02-sekrety.md).
 */

import { rename, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { parseSettings } from '@shared/schemas/settings-validation';
import { DEFAULT_SETTINGS, type TerminalSettings } from '@shared/types/settings';

let cache: TerminalSettings | undefined;

function configPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<TerminalSettings> {
  if (cache) return cache;

  try {
    const raw = await readFile(configPath(), 'utf8');
    // parseSettings nigdy nie rzuca — ręcznie popsuty plik schodzi do wartości
    // domyślnych zamiast blokować uruchomienie aplikacji.
    cache = parseSettings(JSON.parse(raw));
  } catch {
    // Brak pliku przy pierwszym uruchomieniu albo niepoprawny JSON.
    cache = { ...DEFAULT_SETTINGS };
  }

  return cache;
}

export async function saveSettings(payload: unknown): Promise<TerminalSettings> {
  const settings = parseSettings(payload);
  cache = settings;

  const target = configPath();
  const temp = `${target}.tmp`;

  // Zapis atomowy: najpierw plik tymczasowy, potem podmiana. Przerwanie w trakcie
  // zapisu zostawiłoby inaczej obcięty plik konfiguracyjny.
  await writeFile(temp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(temp, target);

  return settings;
}
