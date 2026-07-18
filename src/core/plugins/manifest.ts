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
  'ai.tools'
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
export interface ToolContribution {
  id: string;
  description: string;
  parameters: Record<string, unknown>;
  risky?: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Wersja Plugin API, z którą wtyczka jest zgodna. */
  apiVersion: string;
  /** Względna ścieżka do zbundlowanego pliku wtyczki. */
  main: string;
  permissions: Permission[];
  contributes: {
    commands: CommandContribution[];
    /** Narzędzia AI (opcjonalne) — wymagają uprawnienia `ai.tools`. */
    tools?: ToolContribution[];
  };
}

/** Czy manifest deklaruje dane uprawnienie. Podstawa egzekucji na granicy RPC. */
export function hasPermission(manifest: PluginManifest, permission: Permission): boolean {
  return manifest.permissions.includes(permission);
}
