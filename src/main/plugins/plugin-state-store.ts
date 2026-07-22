/**
 * Trwały stan wtyczek: które są wyłączone i którym udzielono zaufania.
 *
 * Wtyczka w piaskownicy jest domyślnie WŁĄCZONA — zapisujemy tylko zbiór wyłączonych id,
 * więc nowa wtyczka działa od razu. Nie może tak być z wtyczką `runtime: "node"`: ona
 * dostaje pełny dostęp do komputera, więc dopóki użytkownik świadomie jej nie włączy,
 * jej proces w ogóle nie wstaje. Dlatego drugi zbiór: ZAUFANE.
 *
 * Plik: userData/plugins-state.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

function statePath(): string {
  return join(app.getPath('userData'), 'plugins-state.json');
}

interface Stan {
  disabled: Set<string>;
  trusted: Set<string>;
  /**
   * Wtyczki, których narzędzia wolno pokazać agentowi AI.
   *
   * OSOBNA zgoda, domyślnie pusta — nawet zaufana wtyczka nie trafia do zestawu narzędzi
   * modelu, dopóki użytkownik tego nie włączy. Powód: agent działa sam, w pętli, i wywoła
   * narzędzie bez pytania; to zupełnie inne ryzyko niż komenda uruchomiona ręcznie.
   */
  aiTools: Set<string>;
}

let stan: Stan | undefined;

function load(): Stan {
  if (stan) return stan;
  const zbior = (value: unknown): Set<string> =>
    new Set(Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8')) as {
      disabled?: unknown;
      trusted?: unknown;
      aiTools?: unknown;
    };
    stan = { disabled: zbior(raw.disabled), trusted: zbior(raw.trusted), aiTools: zbior(raw.aiTools) };
  } catch {
    stan = { disabled: new Set(), trusted: new Set(), aiTools: new Set() };
  }
  return stan;
}

function persist(): void {
  const s = load();
  try {
    writeFileSync(
      statePath(),
      JSON.stringify({ disabled: [...s.disabled], trusted: [...s.trusted], aiTools: [...s.aiTools] }, null, 2),
      'utf8'
    );
  } catch (error) {
    console.warn('[plugins] nie zapisano stanu wtyczek:', (error as Error).message);
  }
}

export function isDisabled(id: string): boolean {
  return load().disabled.has(id);
}

export function setDisabled(id: string, value: boolean): void {
  const s = load();
  if (value) s.disabled.add(id);
  else s.disabled.delete(id);
  persist();
}

/**
 * Czy użytkownik świadomie zgodził się uruchamiać tę wtyczkę z pełnym dostępem.
 *
 * Domyślnie NIE. Zgoda jest tu zapamiętana po identyfikatorze; przypięcie jej do sumy
 * kontrolnej katalogu (żeby podmiana kodu unieważniała zgodę) dochodzi w kolejnym etapie.
 */
export function isTrusted(id: string): boolean {
  return load().trusted.has(id);
}

/** Czy narzędzia tej wtyczki wolno pokazać agentowi AI. Domyślnie NIE. */
export function aiToolsAllowed(id: string): boolean {
  return load().aiTools.has(id);
}

export function setAiToolsAllowed(id: string, value: boolean): void {
  const s = load();
  if (value) s.aiTools.add(id);
  else s.aiTools.delete(id);
  persist();
}

export function setTrusted(id: string, value: boolean): void {
  const s = load();
  if (value) s.trusted.add(id);
  else s.trusted.delete(id);
  persist();
}
