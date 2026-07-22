/**
 * Bramka RPC wtyczek (Plugin API v2, etap 2).
 *
 * JEDYNE miejsce, w którym żądanie wtyczki zamienia się w działanie aplikacji. Każde
 * przechodzi tę samą ścieżkę: wtyczka aktywna → metoda istnieje → uprawnienie zadeklarowane
 * → argumenty zwalidowane → wykonanie. Brak uprawnienia daje wtyczce czytelny kod błędu,
 * a nie ciche nic (tak było w v1).
 *
 * Uwaga o zakresie gwarancji: wtyczka `runtime: "node"` i tak ma pliki oraz sieć, bo ma
 * Node — bramka chroni to, co należy do APLIKACJI (zakładki, powiadomienia, komendy,
 * magazyn), a nie system operacyjny. Tak też jest opisana w D7.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { hasPermission, type Permission, type PluginManifest } from '@core/plugins/manifest';
import { RpcError, RPC_TIMEOUT_MS, type RpcMessage, type RpcRequest } from '@core/plugins/protocol';
import { userDirs } from '../user-dirs';

/** Co bramka musi wiedzieć o wtyczce, żeby podjąć decyzję. */
export interface KontekstWtyczki {
  manifest: PluginManifest;
  /** Ustawia albo usuwa element paska statusu tej wtyczki. */
  ustawElementPaska: (item: { id: string; text: string; tooltip?: string; command?: string } | { id: string; usun: true }) => void;
  /** Dopisuje komendę do listy widocznej w palecie; zwraca `false`, gdy nie zadeklarowana. */
  zarejestrujKomende: (commandId: string) => boolean;
  pokazPowiadomienie: (message: string, level: string) => void;
}

/** Zdolność wystawiana wtyczkom. `permission` puste = dostępna zawsze. */
interface Zdolnosc {
  permission?: Permission;
  wykonaj: (ctx: KontekstWtyczki, params: Record<string, unknown>) => unknown;
}

/** Znacznik startu aplikacji — wtyczki liczą z niego czas sesji. */
const startedAt = Date.now();

/** Ostatni stan aktywnej zakładki zgłoszony przez renderer. */
let aktywnaZakladka: { title: string; kind: string } | null = null;

/** Wysyłka do procesu wtyczki — wstrzykiwana przez menedżera, żeby uniknąć cyklu importów. */
type Wysylka = (pluginId: string, message: unknown) => boolean;
let wyslijDoWtyczki: Wysylka = () => false;

export function ustawWysylke(wysylka: Wysylka): void {
  wyslijDoWtyczki = wysylka;
}

// --- magazyn wtyczki -----------------------------------------------------------------

function plikDanych(pluginId: string): string {
  const bezpieczny = pluginId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return join(userDirs().pluginsData, `${bezpieczny}.json`);
}

function wczytajDane(pluginId: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(plikDanych(pluginId), 'utf8'));
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function zapiszDane(pluginId: string, dane: Record<string, unknown>): void {
  writeFileSync(plikDanych(pluginId), JSON.stringify(dane, null, 2), 'utf8');
}

// --- katalog zdolności ---------------------------------------------------------------

function tekst(params: Record<string, unknown>, key: string, max: number): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new BladZdolnosci(RpcError.Invalid, `pole "${key}" musi być tekstem do ${max} znaków`);
  }
  return value;
}

class BladZdolnosci extends Error {
  constructor(
    readonly code: (typeof RpcError)[keyof typeof RpcError],
    message: string
  ) {
    super(message);
  }
}

const ZDOLNOSCI: Record<string, Zdolnosc> = {
  'app.info': {
    wykonaj: () => ({ name: 'LumaShell', version: app.getVersion(), startedAt })
  },

  'commands.register': {
    permission: 'commands.register',
    wykonaj: (ctx, params) => {
      const commandId = tekst(params, 'commandId', 80);
      // Komenda musi być w manifeście — inaczej wtyczka mogłaby dorzucić do palety cokolwiek.
      if (!ctx.zarejestrujKomende(commandId)) {
        throw new BladZdolnosci(RpcError.Denied, `komenda ${commandId} nie jest zadeklarowana w manifeście`);
      }
      return true;
    }
  },

  'notifications.show': {
    permission: 'notifications.show',
    wykonaj: (ctx, params) => {
      const message = tekst(params, 'message', 500);
      const level = typeof params['level'] === 'string' ? params['level'] : 'info';
      ctx.pokazPowiadomienie(message, level === 'warn' || level === 'error' ? level : 'info');
      return true;
    }
  },

  'workspace.activeTab': {
    wykonaj: () => aktywnaZakladka
  },

  'storage.get': {
    wykonaj: (ctx, params) => wczytajDane(ctx.manifest.id)[tekst(params, 'key', 120)]
  },

  'storage.set': {
    wykonaj: (ctx, params) => {
      const key = tekst(params, 'key', 120);
      const dane = wczytajDane(ctx.manifest.id);
      // Wartość idzie do pliku JSON, więc musi być serializowalna; rozmiar jest ograniczony,
      // żeby wtyczka nie zrobiła sobie z magazynu ustawień bazy danych.
      const json = JSON.stringify(params['value'] ?? null);
      if (json.length > 64_000) throw new BladZdolnosci(RpcError.Invalid, 'wartość za duża (limit 64 kB)');
      dane[key] = JSON.parse(json);
      zapiszDane(ctx.manifest.id, dane);
      return true;
    }
  },

  'storage.path': {
    wykonaj: (ctx) => plikDanych(ctx.manifest.id)
  },

  'ui.statusBar.set': {
    permission: 'ui.statusBar',
    wykonaj: (ctx, params) => {
      // Tekst w oknie aplikacji ma być krótki i nie udawać komunikatu LumaShella —
      // obok i tak pokazujemy nazwę wtyczki.
      const item: { id: string; text: string; tooltip?: string; command?: string } = {
        id: tekst(params, 'id', 60),
        text: tekst(params, 'text', 40)
      };
      if (typeof params['tooltip'] === 'string') item.tooltip = params['tooltip'].slice(0, 200);
      if (typeof params['command'] === 'string') {
        const commandId = params['command'];
        // Klik nie może uruchomić czegoś, czego nie ma w manifeście.
        if (!ctx.manifest.contributes.commands.some((c) => c.id === commandId)) {
          throw new BladZdolnosci(RpcError.Denied, `komenda ${commandId} nie jest zadeklarowana w manifeście`);
        }
        item.command = commandId;
      }
      ctx.ustawElementPaska(item);
      return true;
    }
  },

  'ui.statusBar.remove': {
    permission: 'ui.statusBar',
    wykonaj: (ctx, params) => {
      ctx.ustawElementPaska({ id: tekst(params, 'id', 60), usun: true });
      return true;
    }
  }
};

// --- obsługa żądań -------------------------------------------------------------------

/** Aktualizacja stanu z renderera + rozesłanie zdarzenia do wtyczek. */
export function ustawAktywnaZakladke(
  tab: { title: string; kind: string } | null,
  aktywneWtyczki: () => string[]
): void {
  const takaSama =
    (aktywnaZakladka === null && tab === null) ||
    (aktywnaZakladka !== null && tab !== null && aktywnaZakladka.title === tab.title && aktywnaZakladka.kind === tab.kind);
  if (takaSama) return;
  aktywnaZakladka = tab;
  for (const pluginId of aktywneWtyczki()) {
    wyslijDoWtyczki(pluginId, { kind: 'evt', event: 'workspace.activeTabChanged', payload: tab });
  }
}

/** Obsługuje żądanie od wtyczki i odsyła wynik. */
export function obsluzZadanie(pluginId: string, request: RpcRequest, ctx: KontekstWtyczki | undefined): void {
  const odpowiedz = (message: RpcMessage): void => {
    wyslijDoWtyczki(pluginId, message);
  };
  const blad = (code: (typeof RpcError)[keyof typeof RpcError], message: string): void =>
    odpowiedz({ kind: 'err', id: request.id, code, message });

  if (!ctx) return blad(RpcError.Denied, 'wtyczka nie jest aktywna');

  const zdolnosc = ZDOLNOSCI[request.method];
  if (!zdolnosc) return blad(RpcError.Unknown, `nieznana metoda: ${request.method}`);

  if (zdolnosc.permission && !hasPermission(ctx.manifest, zdolnosc.permission)) {
    return blad(RpcError.Denied, `brak uprawnienia ${zdolnosc.permission} w manifeście wtyczki`);
  }

  const params =
    typeof request.params === 'object' && request.params !== null && !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : {};

  try {
    const result = zdolnosc.wykonaj(ctx, params);
    odpowiedz({ kind: 'res', id: request.id, result: result === undefined ? null : result });
  } catch (error) {
    if (error instanceof BladZdolnosci) return blad(error.code, error.message);
    blad(RpcError.Failed, error instanceof Error ? error.message : String(error));
  }
}

// --- żądania aplikacja → wtyczka -----------------------------------------------------

let licznik = 0;
const oczekujace = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

/** Woła metodę wtyczki (np. uruchomienie komendy) i czeka na odpowiedź. */
export function zadaj(pluginId: string, method: string, params?: unknown): Promise<unknown> {
  const id = `h${++licznik}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      oczekujace.delete(id);
      reject(new Error(`Wtyczka nie odpowiedziała na ${method}`));
    }, RPC_TIMEOUT_MS);
    oczekujace.set(id, { resolve, reject, timer });
    const wyslano = wyslijDoWtyczki(pluginId, { kind: 'req', id, method, params });
    if (!wyslano) {
      clearTimeout(timer);
      oczekujace.delete(id);
      reject(new Error('Proces wtyczki nie działa'));
    }
  });
}

/** Rozwiązuje odpowiedź na żądanie aplikacji. */
export function obsluzOdpowiedz(message: RpcMessage): void {
  if (message.kind !== 'res' && message.kind !== 'err') return;
  const czeka = oczekujace.get(message.id);
  if (!czeka) return;
  clearTimeout(czeka.timer);
  oczekujace.delete(message.id);
  if (message.kind === 'res') czeka.resolve(message.result);
  else czeka.reject(new Error(`${message.code}: ${message.message}`));
}
