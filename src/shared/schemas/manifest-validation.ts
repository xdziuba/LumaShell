/**
 * Walidacja manifestu wtyczki.
 *
 * Manifest pochodzi z niezaufanego źródła (katalog wtyczki), więc jest w całości
 * sprawdzany. Nieznane uprawnienia są odrzucane — wtyczka nie dostanie zdolności, o którą
 * nie umiała poprawnie poprosić (docs/plugin-api/02-uprawnienia-i-izolacja.md).
 */

import type { Permission, PluginManifest, ToolContribution } from '@core/plugins/manifest';

/**
 * Allowlista uprawnień egzekwowana przez walidator.
 *
 * Świadomie zdublowana względem PERMISSIONS w core: granica bezpieczeństwa trzyma własną
 * listę, żeby nowe uprawnienie z core nie „przeciekło" do akceptowanych, zanim ktoś je tu
 * świadomie doda. TypeScript pilnuje, by wartości były poprawnymi `Permission`.
 */
const ALLOWED_PERMISSIONS: readonly Permission[] = [
  'commands.register',
  'notifications.show',
  'terminal.read',
  'terminal.write',
  'ai.tools'
];

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(`Nieprawidłowy manifest wtyczki: ${message}`);
    this.name = 'ManifestValidationError';
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ManifestValidationError(`${what} musi być obiektem`);
  }
  return value as Record<string, unknown>;
}

/** Identyfikatory/ścieżki: bez znaków ścieżkowych i składni, żeby nie wyjść z katalogu wtyczki. */
function safeString(source: Record<string, unknown>, key: string, max: number): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new ManifestValidationError(`pole "${key}" musi być niepustym tekstem do ${max} znaków`);
  }
  return value;
}

/** Ścieżka `main` musi być względna i nie wychodzić poza katalog wtyczki. */
function safeMain(source: Record<string, unknown>): string {
  const value = safeString(source, 'main', 256);
  if (value.startsWith('/') || value.startsWith('\\') || value.includes('..') || /^[a-zA-Z]:/.test(value)) {
    throw new ManifestValidationError('"main" musi być ścieżką względną w katalogu wtyczki');
  }
  return value;
}

const PERMISSION_SET = new Set<string>(ALLOWED_PERMISSIONS);

export function parseManifest(payload: unknown): PluginManifest {
  const src = record(payload, 'manifest');

  const rawPerms = Array.isArray(src['permissions']) ? src['permissions'] : [];
  const permissions: Permission[] = [];
  for (const p of rawPerms) {
    if (typeof p === 'string' && PERMISSION_SET.has(p)) permissions.push(p as Permission);
    else console.warn('[plugins] pominięto nieznane uprawnienie:', String(p));
  }

  const contributes = record(src['contributes'] ?? {}, 'contributes');
  const rawCommands = Array.isArray(contributes['commands']) ? contributes['commands'] : [];
  const commands = rawCommands.map((raw) => {
    const c = record(raw, 'command');
    return { id: safeString(c, 'id', 80), title: safeString(c, 'title', 120) };
  });

  const rawTools = Array.isArray(contributes['tools']) ? contributes['tools'] : [];
  const tools: ToolContribution[] = rawTools.map((raw) => {
    const t = record(raw, 'tool');
    const tool: ToolContribution = {
      id: safeString(t, 'id', 64),
      description: safeString(t, 'description', 4000),
      // Schemat wejścia idzie wprost do API modelu; przyjmujemy dowolny obiekt (albo pusty).
      parameters: record(t['parameters'] ?? {}, 'parameters')
    };
    if (t['risky'] === true) tool.risky = true;
    return tool;
  });

  return {
    id: safeString(src, 'id', 80),
    name: safeString(src, 'name', 120),
    version: safeString(src, 'version', 32),
    apiVersion: safeString(src, 'apiVersion', 8),
    main: safeMain(src),
    permissions,
    contributes: tools.length > 0 ? { commands, tools } : { commands }
  };
}
