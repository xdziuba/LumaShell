/**
 * Konfiguracja dostawcy AI w procesie głównym (AI-0).
 *
 * Provider/baseUrl/model leżą jawnie w userData/ai-config.json — to nie są sekrety. KLUCZ API
 * trafia do safeStorage przez credential-store (szyfrowany DPAPI) i NIGDY nie wraca do
 * renderera; renderer dostaje tylko flagę `hasKey` (docs/security/02-sekrety.md).
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AiConfig, AiProvider, AiProviderKind } from '@core/ai/provider';
import { OPENAI_DEFAULT_BASE_URL } from '@core/ai/provider';
import { deleteSecret, getSecret, hasSecret, setSecret } from '../credential-store';
import { OpenAiCompatibleProvider } from '@services/ai/openai-compatible';
import { AnthropicProvider } from '@services/ai/anthropic-provider';

const KEY_ID = 'ai.apiKey';
const PROVIDERS: readonly AiProviderKind[] = ['openai', 'anthropic', 'local', 'custom'];

interface StoredConfig {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
}

const DEFAULT: StoredConfig = {
  provider: 'openai',
  baseUrl: OPENAI_DEFAULT_BASE_URL,
  model: 'gpt-4o-mini'
};

let cache: StoredConfig | undefined;

function filePath(): string {
  return join(app.getPath('userData'), 'ai-config.json');
}

/** Sprowadza niezaufane dane do poprawnego kształtu (z domyślnymi). */
function sanitize(raw: unknown): StoredConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const provider = PROVIDERS.includes(r['provider'] as AiProviderKind)
    ? (r['provider'] as AiProviderKind)
    : DEFAULT.provider;
  const baseUrl =
    typeof r['baseUrl'] === 'string' && /^https?:\/\//i.test(r['baseUrl']) && r['baseUrl'].length <= 500
      ? r['baseUrl']
      : DEFAULT.baseUrl;
  const model =
    typeof r['model'] === 'string' && r['model'].length > 0 && r['model'].length <= 200
      ? r['model']
      : DEFAULT.model;
  return { provider, baseUrl, model };
}

async function load(): Promise<StoredConfig> {
  if (cache) return cache;
  try {
    cache = sanitize(JSON.parse(await readFile(filePath(), 'utf8')));
  } catch {
    cache = { ...DEFAULT };
  }
  return cache;
}

async function persist(config: StoredConfig): Promise<void> {
  cache = config;
  const target = filePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2), 'utf8');
  await rename(temp, target);
}

export async function getAiConfig(): Promise<AiConfig> {
  const c = await load();
  return { ...c, hasKey: await hasSecret(KEY_ID) };
}

/**
 * Zapisuje konfigurację. `apiKey`: undefined = nie ruszaj klucza; '' = usuń klucz; wartość =
 * zapisz nowy klucz. Zwraca konfigurację po walidacji (renderer bierze prawdę stąd).
 */
export async function saveAiConfig(rawConfig: unknown, apiKey: string | null | undefined): Promise<AiConfig> {
  await persist(sanitize(rawConfig));
  if (typeof apiKey === 'string') {
    if (apiKey.length > 0) await setSecret(KEY_ID, apiKey);
    else await deleteSecret(KEY_ID);
  }
  return getAiConfig();
}

/** Buduje dostawcę z bieżącej konfiguracji i odszyfrowanego klucza — wyłącznie w main. */
export async function getAiProvider(): Promise<AiProvider> {
  const c = await load();
  const apiKey = await getSecret(KEY_ID);
  // Anthropic mówi innym protokołem (Messages API), więc dostaje własną implementację;
  // OpenAI/lokalny/własny endpoint dzielą jedną, bo różni je tylko baseUrl i klucz.
  if (c.provider === 'anthropic') {
    return new AnthropicProvider({ baseUrl: c.baseUrl, apiKey });
  }
  return new OpenAiCompatibleProvider({ kind: c.provider, baseUrl: c.baseUrl, apiKey });
}
