/**
 * Trwały stan wtyczek: które są wyłączone (Etap UI — menedżer wtyczek).
 *
 * Domyślnie wtyczka jest włączona; zapisujemy jedynie zbiór WYŁĄCZONYCH id w pliku
 * userData/plugins-state.json. Świadoma decyzja: brak wpisu = włączona, więc nowe wtyczki
 * działają od razu.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

function statePath(): string {
  return join(app.getPath('userData'), 'plugins-state.json');
}

let disabled: Set<string> | undefined;

function load(): Set<string> {
  if (disabled) return disabled;
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8')) as { disabled?: unknown };
    const list = Array.isArray(raw.disabled) ? raw.disabled.filter((x): x is string => typeof x === 'string') : [];
    disabled = new Set(list);
  } catch {
    disabled = new Set();
  }
  return disabled;
}

export function isDisabled(id: string): boolean {
  return load().has(id);
}

export function setDisabled(id: string, value: boolean): void {
  const set = load();
  if (value) set.add(id);
  else set.delete(id);
  try {
    writeFileSync(statePath(), JSON.stringify({ disabled: [...set] }, null, 2), 'utf8');
  } catch (error) {
    console.warn('[plugins] nie zapisano stanu wtyczek:', (error as Error).message);
  }
}
