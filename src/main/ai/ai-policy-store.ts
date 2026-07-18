/**
 * Polityka autonomii agenta AI (AI-7) w procesie głównym.
 *
 * Konfigurowalne, trwałe limity biegu agenta: liczba kroków, liczba akcji, budżet czasu i
 * budżet tokenów (limit kosztów). Leżą jawnie w userData/ai-policy.json — to nie są sekrety.
 * Renderer bierze je stąd i przekazuje do runnera; zawsze sprowadzamy do rozsądnego zakresu.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AiPolicy } from '@shared/types/ipc';

const DEFAULT: AiPolicy = {
  maxSteps: 12,
  maxActions: 10,
  timeoutMs: 180_000,
  tokenBudget: 0
};

/** Zakresy zdroworozsądkowe — chronią przed absurdami z pliku i z UI. */
const RANGES = {
  maxSteps: { min: 1, max: 50 },
  maxActions: { min: 0, max: 50 },
  timeoutMs: { min: 10_000, max: 1_800_000 },
  tokenBudget: { min: 0, max: 10_000_000 }
} as const;

let cache: AiPolicy | undefined;

function filePath(): string {
  return join(app.getPath('userData'), 'ai-policy.json');
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Sprowadza niezaufane dane do poprawnej polityki (z domyślnymi i zakresami). */
function sanitize(raw: unknown): AiPolicy {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    maxSteps: clampInt(r['maxSteps'], RANGES.maxSteps.min, RANGES.maxSteps.max, DEFAULT.maxSteps),
    maxActions: clampInt(r['maxActions'], RANGES.maxActions.min, RANGES.maxActions.max, DEFAULT.maxActions),
    timeoutMs: clampInt(r['timeoutMs'], RANGES.timeoutMs.min, RANGES.timeoutMs.max, DEFAULT.timeoutMs),
    tokenBudget: clampInt(r['tokenBudget'], RANGES.tokenBudget.min, RANGES.tokenBudget.max, DEFAULT.tokenBudget)
  };
}

export async function getAiPolicy(): Promise<AiPolicy> {
  if (cache) return cache;
  try {
    cache = sanitize(JSON.parse(await readFile(filePath(), 'utf8')));
  } catch {
    cache = { ...DEFAULT };
  }
  return cache;
}

/** Zapisuje politykę po walidacji; zwraca wartości faktycznie utrwalone (renderer bierze prawdę stąd). */
export async function saveAiPolicy(raw: unknown): Promise<AiPolicy> {
  const policy = sanitize(raw);
  cache = policy;
  const target = filePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(policy, null, 2), 'utf8');
  await rename(temp, target);
  return policy;
}
