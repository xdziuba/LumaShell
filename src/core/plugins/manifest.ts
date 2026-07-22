/**
 * Manifest wtyczki i model uprawnień (Etap 6).
 *
 * Czysta logika w `core` — bez IPC ani DOM. Odpowiada docs/plugin-api/01-przeglad-i-manifest.
 *
 * Zgodnie z decyzją D2 (docs/architecture/10-decyzje.md) wtyczki działają BEZ integracji
 * Node.js i komunikują się wyłącznie przez RPC. Uprawnienia z manifestu są egzekwowane na
 * granicy RPC w procesie głównym — deklaracja tutaj to kontrakt, nie dobra wola wtyczki.
 */

/** Uprawnienia, które wtyczka może zadeklarować. */
export const PERMISSIONS = [
  'commands.register',
  'notifications.show',
  'terminal.read',
  'terminal.write',
  'ai.tools',
  /**
   * Własny element na pasku statusu. Wtyczka pisze tam TEKST widoczny w oknie aplikacji,
   * więc jest to uprawnienie: obok zawsze pokazujemy, która wtyczka go dodała, a długość
   * jest przycinana — pasek nie może udawać komunikatu LumaShella.
   */
  'ui.statusBar',
  /**
   * Własny widok (drzewo) otwierany jako zakładka. Wtyczka nie rysuje niczego sama —
   * dostarcza DANE, a rysuje je LumaShell w swoim motywie. Uprawnienie jest po to, żeby
   * w menedżerze było widać, że wtyczka dokłada coś do interfejsu.
   */
  'ui.views'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface CommandContribution {
  id: string;
  title: string;
}

/**
 * Narzędzie AI udostępniane modelowi przez wtyczkę (AI-6). `parameters` to JSON Schema
 * wejścia. `risky` = akcja: pętla agenta poprosi wtedy o zgodę użytkownika (jak przy
 * wbudowanych akcjach z AI-3).
 */
/**
 * Widok wtyczki — drzewo pokazywane jako zakładka. Zawartość dostarcza wtyczka przez
 * `registerTreeDataProvider`, a renderuje ją aplikacja.
 */
export interface ViewContribution {
  id: string;
  title: string;
}

export interface ToolContribution {
  id: string;
  description: string;
  parameters: Record<string, unknown>;
  risky?: boolean;
}

/**
 * Środowisko wykonania kodu wtyczki.
 *
 * `sandbox` — ukryte okno bez Node (v1). Bezpieczne, ale potrafi tylko dokładać komendy
 * i narzędzia AI: bez plików, bez sieci, bez własnego widoku.
 *
 * `node` — WŁASNY proces (`utilityProcess`) z pełnym Node: `fs`, `net`, `child_process`,
 * własne `node_modules`. To jest cena za realną rozszerzalność i jest ona jawna: uprawnienia
 * do plików, sieci i uruchamiania procesów przestają być granicą techniczną (zmierzone na
 * Electronie 43.1.1: `process.permission` w utilityProcess jest `undefined`, a flaga
 * `--permission` jest ignorowana). Dlatego takich uprawnień świadomie NIE MA w katalogu —
 * lista uprawnień ma nie kłamać. Granicą zostaje to, co należy do APLIKACJI: terminal,
 * zakładki, sekrety, narzędzia AI — wyłącznie przez RPC z bramką w procesie głównym.
 */
export type PluginRuntime = 'sandbox' | 'node';

/** Wersje Plugin API, które ta wersja aplikacji rozumie. */
export const SUPPORTED_API_VERSIONS = ['1', '2'] as const;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Wersja Plugin API, z którą wtyczka jest zgodna. */
  apiVersion: string;
  /** Brak pola = `sandbox`, czyli zachowanie z v1. */
  runtime: PluginRuntime;
  /** Względna ścieżka do zbundlowanego pliku wtyczki. */
  main: string;
  /** Opis dla użytkownika — pokazywany w menedżerze i w oknie zgody. */
  description?: string;
  permissions: Permission[];
  contributes: {
    commands: CommandContribution[];
    /** Narzędzia AI (opcjonalne) — wymagają uprawnienia `ai.tools`. */
    tools?: ToolContribution[];
    /** Widoki-drzewa (opcjonalne) — wymagają uprawnienia `ui.views`. */
    views?: ViewContribution[];
  };
}

/** Czy manifest deklaruje dane uprawnienie. Podstawa egzekucji na granicy RPC. */
export function hasPermission(manifest: PluginManifest, permission: Permission): boolean {
  return manifest.permissions.includes(permission);
}

/**
 * Czy wtyczka działa z pełnym dostępem do systemu.
 *
 * Jedno miejsce, w które patrzy interfejs, zanim powie użytkownikowi prawdę o wtyczce —
 * i jedno miejsce, którego trzyma się bramka „nie uruchamiaj bez zgody".
 */
export function wymagaZaufania(manifest: PluginManifest): boolean {
  return manifest.runtime === 'node';
}
