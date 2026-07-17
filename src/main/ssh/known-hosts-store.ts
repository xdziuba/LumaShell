/**
 * Trwały magazyn zaufanych kluczy hostów SSH.
 *
 * `known-hosts.json` w katalogu danych aplikacji: mapa `host:port → odcisk`. Niezależny
 * od systemowego `~/.ssh/known_hosts` (integracja z nim to osobny temat — wpisy hashowane
 * wymagają dopasowania HMAC per host).
 */

import { rename, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { evaluateHost, hostKey, type HostTrust } from '@core/ssh/known-hosts';

type HostMap = Record<string, string>;

let cache: HostMap | undefined;

function filePath(): string {
  return join(app.getPath('userData'), 'known-hosts.json');
}

async function load(): Promise<HostMap> {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath(), 'utf8'));
    cache =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as HostMap)
        : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(map: HostMap): Promise<void> {
  cache = map;
  const target = filePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(map, null, 2), 'utf8');
  await rename(temp, target);
}

/** Ocena prezentowanego odcisku względem tego, co znamy. */
export async function evaluate(host: string, port: number, presented: string): Promise<HostTrust> {
  const map = await load();
  return evaluateHost(map[hostKey(host, port)], presented);
}

/** Zapamiętuje odcisk hosta — po akceptacji nieznanego albo świadomej aktualizacji zmienionego. */
export async function trust(host: string, port: number, fingerprint: string): Promise<void> {
  const map = { ...(await load()) };
  map[hostKey(host, port)] = fingerprint;
  await persist(map);
}
