/**
 * Trwały magazyn motywów: wybrany motyw i motywy własne.
 *
 * `themes.json` w katalogu danych aplikacji. Motywy wbudowane są w kodzie; tu trzymamy
 * tylko wybór aktywnego i ewentualne własne/zaimportowane motywy.
 */

import { readdir, rename, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { parseTheme } from '@shared/schemas/theme-validation';
import { BUILT_IN_THEMES, type Theme } from '@core/theme/theme';
import { userDirs } from './user-dirs';

interface Persisted {
  selectedId: string;
  custom: Theme[];
}

let cache: Persisted | undefined;

/** Skąd pochodzi motyw wczytany z katalogu — potrzebne, by „Usuń" kasowało właściwy plik. */
const fromDirectory = new Map<string, string>();

function filePath(): string {
  return join(app.getPath('userData'), 'themes.json');
}

/**
 * Motywy wrzucone jako pliki do `userData/themes`.
 *
 * Prostsza droga niż import przez okno dialogowe: kopiujesz plik do katalogu (albo dostajesz
 * go z repozytorium motywów) i po odświeżeniu jest na liście. Uszkodzone pliki są pomijane —
 * jeden zły JSON nie może wywalić listy motywów.
 */
async function loadFromDirectory(): Promise<Theme[]> {
  fromDirectory.clear();
  let entries: string[] = [];
  try {
    entries = await readdir(userDirs().themes);
  } catch {
    return [];
  }

  const out: Theme[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const path = join(userDirs().themes, name);
    try {
      const theme = parseTheme(JSON.parse(await readFile(path, 'utf8')));
      // Motyw wbudowany o tym samym id zostaje — plik użytkownika go nie podmienia.
      if (BUILT_IN_THEMES.some((t) => t.id === theme.id)) continue;
      out.push(theme);
      fromDirectory.set(theme.id, path);
    } catch (error) {
      console.warn(`[motywy] pominięto ${name}:`, (error as Error).message);
    }
  }
  return out;
}

/** Wszystkie motywy własne: z themes.json + z katalogu (bez duplikatów po id). */
async function customThemes(): Promise<Theme[]> {
  const stored = (await load()).custom;
  const dir = await loadFromDirectory();
  return [...stored, ...dir.filter((t) => !stored.some((s) => s.id === t.id))];
}

async function load(): Promise<Persisted> {
  if (cache) return cache;
  try {
    const raw: unknown = JSON.parse(await readFile(filePath(), 'utf8'));
    const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const custom = Array.isArray(src['custom'])
      ? src['custom'].flatMap((t) => {
          try {
            return [parseTheme(t)];
          } catch {
            return [];
          }
        })
      : [];
    cache = {
      selectedId: typeof src['selectedId'] === 'string' ? src['selectedId'] : BUILT_IN_THEMES[0]!.id,
      custom
    };
  } catch {
    cache = { selectedId: BUILT_IN_THEMES[0]!.id, custom: [] };
  }
  return cache;
}

async function persist(next: Persisted): Promise<void> {
  cache = next;
  const target = filePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
  await rename(temp, target);
}

/** Wszystkie motywy: wbudowane + własne (themes.json + katalog użytkownika). */
export async function listThemes(): Promise<Theme[]> {
  return [...BUILT_IN_THEMES, ...(await customThemes())];
}

/** Aktualny stan dla renderera: lista motywów i id wybranego. */
export async function getThemeState(): Promise<{ themes: Theme[]; selectedId: string }> {
  const state = await load();
  const themes = [...BUILT_IN_THEMES, ...(await customThemes())];
  // Wybrany motyw mógł zniknąć (usunięty własny) — wracamy wtedy do domyślnego.
  const selectedId = themes.some((t) => t.id === state.selectedId)
    ? state.selectedId
    : BUILT_IN_THEMES[0]!.id;
  return { themes, selectedId };
}

export async function selectTheme(id: unknown): Promise<void> {
  if (typeof id !== 'string') return;
  await persist({ ...(await load()), selectedId: id });
}

/** Zapis własnego motywu (upsert po id). Motywów wbudowanych nie nadpisuje. */
export async function saveCustomTheme(payload: unknown): Promise<Theme[]> {
  const theme = parseTheme(payload);
  if (BUILT_IN_THEMES.some((t) => t.id === theme.id)) {
    throw new Error('Nie można nadpisać motywu wbudowanego');
  }
  const state = await load();
  const index = state.custom.findIndex((t) => t.id === theme.id);
  const custom = index === -1 ? [...state.custom, theme] : state.custom.map((t, i) => (i === index ? theme : t));
  await persist({ ...state, custom });
  return listThemes();
}

export async function deleteCustomTheme(id: unknown): Promise<Theme[]> {
  if (typeof id !== 'string') return listThemes();

  // Motyw z katalogu użytkownika trzeba skasować z DYSKU — samo wyrzucenie go z themes.json
  // nic by nie dało, bo wróciłby przy następnym skanie.
  await listThemes(); // odświeża mapę plików
  const file = fromDirectory.get(id);
  if (file) {
    try {
      await unlink(file);
      fromDirectory.delete(id);
    } catch (error) {
      console.warn(`[motywy] nie udało się usunąć ${file}:`, (error as Error).message);
    }
  }

  const state = await load();
  const custom = state.custom.filter((t) => t.id !== id);
  const selectedId = state.selectedId === id ? BUILT_IN_THEMES[0]!.id : state.selectedId;
  await persist({ selectedId, custom });
  return listThemes();
}
