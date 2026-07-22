/**
 * Walidacja manifestu wtyczki.
 *
 * Manifest pochodzi z niezaufanego źródła (katalog wtyczki), więc jest w całości
 * sprawdzany. Nieznane uprawnienia są odrzucane — wtyczka nie dostanie zdolności, o którą
 * nie umiała poprawnie poprosić (docs/plugin-api/02-uprawnienia-i-izolacja.md).
 */

import type {
  Permission,
  PluginManifest,
  PluginRuntime,
  ToolContribution
} from '@core/plugins/manifest';

/**
 * Obsługiwane wersje Plugin API.
 *
 * Świadomie zdublowane względem SUPPORTED_API_VERSIONS w core — z tego samego powodu, co
 * lista uprawnień niżej: granica trzyma własną listę. Dodatkowa korzyść praktyczna: import
 * z `@core` jest tu WYŁĄCZNIE typem, więc znika przy usuwaniu typów przez Node i testy
 * jednostkowe działają bez bundlera i bez mapowania aliasów.
 */
const OBSLUGIWANE_API = ['1', '2'] as const;

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

  // Wersja API jest teraz SPRAWDZANA. Wcześniej pole było czytane i z niczym nieporównywane,
  // więc wtyczka pisana pod nowsze API ładowała się w połowie i psuła w losowym miejscu.
  const apiVersion = safeString(src, 'apiVersion', 8);
  if (!(OBSLUGIWANE_API as readonly string[]).includes(apiVersion)) {
    throw new ManifestValidationError(
      `apiVersion "${apiVersion}" nie jest obsługiwana przez tę wersję LumaShella (obsługiwane: ${OBSLUGIWANE_API.join(', ')})`
    );
  }

  // Brak pola = stare zachowanie (piaskownica). „node" oznacza własny proces z pełnym Node
  // i wymaga zgody użytkownika — patrz manifest.ts.
  const rawRuntime = src['runtime'];
  if (rawRuntime !== undefined && rawRuntime !== 'sandbox' && rawRuntime !== 'node') {
    throw new ManifestValidationError(`nieznane środowisko wykonania: ${String(rawRuntime)}`);
  }
  const runtime: PluginRuntime = rawRuntime === 'node' ? 'node' : 'sandbox';
  if (runtime === 'node' && apiVersion === '1') {
    throw new ManifestValidationError('runtime "node" wymaga apiVersion "2"');
  }

  const manifest: PluginManifest = {
    id: safeString(src, 'id', 80),
    name: safeString(src, 'name', 120),
    version: safeString(src, 'version', 32),
    apiVersion,
    runtime,
    main: safeMain(src),
    permissions,
    contributes: tools.length > 0 ? { commands, tools } : { commands }
  };
  if (typeof src['description'] === 'string' && src['description'].length > 0) {
    manifest.description = src['description'].slice(0, 500);
  }
  return manifest;
}
