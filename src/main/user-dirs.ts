/**
 * Katalogi użytkownika: wtyczki, motywy, logi.
 *
 * Do tej pory istniał wyłącznie katalog logów (i to tworzony leniwie). Wtyczki były
 * skanowane z `userData/plugins`, którego aplikacja nigdy nie zakładała — w wersji
 * zainstalowanej gałąź „wtyczki użytkownika" była więc martwa: jedyne działające miejsce
 * (`resources/plugins`) siedzi wewnątrz app.asar i jest tylko do odczytu. Tu tworzymy te
 * katalogi na starcie i wystawiamy ich ścieżki, żeby interfejs mógł je pokazać i otworzyć.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { UserDirs } from '@shared/types/ipc';

/** Katalogi, które użytkownik może otworzyć z poziomu aplikacji. */
export type UserDirKind = keyof UserDirs;

let cache: UserDirs | undefined;

export function userDirs(): UserDirs {
  if (!cache) {
    const userData = app.getPath('userData');
    cache = {
      userData,
      plugins: join(userData, 'plugins'),
      themes: join(userData, 'themes'),
      logs: join(userData, 'logs')
    };
  }
  return cache;
}

/**
 * Zakłada katalogi użytkownika. Wołane przed inicjalizacją wtyczek — inaczej pierwszy skan
 * trafiłby na brak katalogu i cicho go pominął.
 *
 * Błąd zapisu (np. dysk tylko do odczytu) nie może zablokować startu: aplikacja ma wtedy
 * działać dalej, tylko bez wtyczek i motywów użytkownika.
 */
export function ensureUserDirs(): void {
  const dirs = userDirs();
  for (const dir of [dirs.plugins, dirs.themes, dirs.logs]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      console.warn(`[katalogi] nie udało się utworzyć ${dir}:`, (error as Error).message);
    }
  }
}

/** Czy tekst z renderera wskazuje jeden ZE ZNANYCH katalogów — biała lista dla `openPath`. */
export function isUserDirKind(kind: unknown): kind is UserDirKind {
  return kind === 'plugins' || kind === 'themes' || kind === 'logs' || kind === 'userData';
}
