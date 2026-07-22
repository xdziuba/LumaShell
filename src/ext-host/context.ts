/**
 * `context` przekazywany do `activate()` wtyczki (Plugin API v2, etap 2).
 *
 * Każda gałąź to cienka nakładka na RPC — cała logika i cała egzekucja uprawnień siedzą
 * w procesie głównym. Tu nie ma żadnej „obrony", bo obrona po stronie wtyczki nie jest
 * obroną: wtyczka ma Node i mogłaby ją ominąć. Ten plik ma być wygodny, nie szczelny.
 */

import { naZadanie, naZdarzenie, wywolaj } from './rpc';

/** Zwięzły opis aktywnej zakładki — tyle, ile aplikacja chce o sobie powiedzieć. */
export interface AktywnaZakladka {
  title: string;
  /** `pty`, `ssh`, `serial`, `network`, `container`, `ai-cli` albo `panel`. */
  kind: string;
}

export interface InfoAplikacji {
  name: string;
  version: string;
  /** Znacznik czasu startu aplikacji (ms) — do liczenia czasu sesji. */
  startedAt: number;
}

export interface LumaContext {
  pluginId: string;
  permissions: string[];
  log: (...args: unknown[]) => void;

  app: {
    getInfo(): Promise<InfoAplikacji>;
  };

  commands: {
    /** Komenda musi być zadeklarowana w manifeście — inaczej aplikacja ją odrzuci. */
    registerCommand(commandId: string, handler: () => unknown | Promise<unknown>): Promise<void>;
  };

  notifications: {
    show(message: string, level?: 'info' | 'warn' | 'error'): Promise<void>;
  };

  workspace: {
    /** Aktywna zakładka albo `null`, gdy żadna nie jest otwarta. */
    getActiveTab(): Promise<AktywnaZakladka | null>;
    /** Nasłuch zmiany aktywnej zakładki; zwraca funkcję wypisującą. */
    onDidChangeActiveTab(callback: (tab: AktywnaZakladka | null) => void): () => void;
  };

  /** Trwały magazyn wtyczki: jeden plik JSON na wtyczkę w katalogu danych aplikacji. */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    /** Ścieżka pliku z danymi — do pokazania użytkownikowi, gdy ma coś w nim ustawić. */
    path(): Promise<string>;
  };
}

export function zbudujKontekst(pluginId: string, permissions: string[]): LumaContext {
  /** Handlery komend wtyczki; aplikacja woła je po `command.invoke`. */
  const komendy = new Map<string, () => unknown | Promise<unknown>>();

  naZadanie('command.invoke', async (params) => {
    const id = (params as { commandId?: string } | undefined)?.commandId;
    const handler = id ? komendy.get(id) : undefined;
    if (!handler) throw new Error(`komenda ${String(id)} nie jest zarejestrowana`);
    await handler();
    return true;
  });

  return {
    pluginId,
    permissions: [...permissions],
    log: (...args: unknown[]) => console.log(...args),

    app: {
      getInfo: () => wywolaj('app.info') as Promise<InfoAplikacji>
    },

    commands: {
      async registerCommand(commandId, handler) {
        komendy.set(commandId, handler);
        await wywolaj('commands.register', { commandId });
      }
    },

    notifications: {
      async show(message, level = 'info') {
        await wywolaj('notifications.show', { message, level });
      }
    },

    workspace: {
      getActiveTab: () => wywolaj('workspace.activeTab') as Promise<AktywnaZakladka | null>,
      onDidChangeActiveTab: (callback) =>
        naZdarzenie('workspace.activeTabChanged', (payload) => callback(payload as AktywnaZakladka | null))
    },

    storage: {
      get: <T,>(key: string) => wywolaj('storage.get', { key }) as Promise<T | undefined>,
      set: async (key, value) => {
        await wywolaj('storage.set', { key, value });
      },
      path: () => wywolaj('storage.path') as Promise<string>
    }
  };
}
