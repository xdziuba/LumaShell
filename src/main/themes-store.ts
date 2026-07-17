/**
 * Trwały magazyn motywów: wybrany motyw i motywy własne.
 *
 * `themes.json` w katalogu danych aplikacji. Motywy wbudowane są w kodzie; tu trzymamy
 * tylko wybór aktywnego i ewentualne własne/zaimportowane motywy.
 */

import { rename, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { parseTheme } from '@shared/schemas/theme-validation';
import { BUILT_IN_THEMES, type Theme } from '@core/theme/theme';

interface Persisted {
  selectedId: string;
  custom: Theme[];
}

let cache: Persisted | undefined;

function filePath(): string {
  return join(app.getPath('userData'), 'themes.json');
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

/** Wszystkie motywy: wbudowane + własne. */
export async function listThemes(): Promise<Theme[]> {
  return [...BUILT_IN_THEMES, ...(await load()).custom];
}

/** Aktualny stan dla renderera: lista motywów i id wybranego. */
export async function getThemeState(): Promise<{ themes: Theme[]; selectedId: string }> {
  const state = await load();
  const themes = [...BUILT_IN_THEMES, ...state.custom];
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
  return [...BUILT_IN_THEMES, ...custom];
}

export async function deleteCustomTheme(id: unknown): Promise<Theme[]> {
  if (typeof id !== 'string') return listThemes();
  const state = await load();
  const custom = state.custom.filter((t) => t.id !== id);
  const selectedId = state.selectedId === id ? BUILT_IN_THEMES[0]!.id : state.selectedId;
  await persist({ selectedId, custom });
  return [...BUILT_IN_THEMES, ...custom];
}
