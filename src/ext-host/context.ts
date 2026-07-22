/**
 * `context` przekazywany do `activate()` wtyczki (Plugin API v2, etap 2).
 *
 * Każda gałąź to cienka nakładka na RPC — cała logika i cała egzekucja uprawnień siedzą
 * w procesie głównym. Tu nie ma żadnej „obrony", bo obrona po stronie wtyczki nie jest
 * obroną: wtyczka ma Node i mogłaby ją ominąć. Ten plik ma być wygodny, nie szczelny.
 */

import { naZadanie, naZdarzenie, wywolaj } from './rpc';

/** Węzeł drzewa oddawany aplikacji. Bez HTML-a i stylów — rysuje LumaShell. */
export interface WezelDrzewa {
  id: string;
  label: string;
  description?: string;
  expandable?: boolean;
  /** Komenda wtyczki wołana po dwukliku; dostanie `nodeId` tego węzła. */
  command?: string;
}

/** Dostawca zawartości drzewa. `nodeId === null` oznacza korzeń. */
export interface DostawcaDrzewa {
  getChildren(nodeId: string | null): WezelDrzewa[] | Promise<WezelDrzewa[]>;
}

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
    /**
     * Komenda musi być zadeklarowana w manifeście — inaczej aplikacja ją odrzuci.
     * `nodeId` jest podawany, gdy komendę uruchomiono z węzła drzewa.
     */
    registerCommand(
      commandId: string,
      handler: (nodeId?: string) => unknown | Promise<unknown>
    ): Promise<void>;
  };

  notifications: {
    show(message: string, level?: 'info' | 'warn' | 'error'): Promise<void>;
  };

  workspace: {
    /** Aktywna zakładka albo `null`, gdy żadna nie jest otwarta. */
    getActiveTab(): Promise<AktywnaZakladka | null>;
    /** Nasłuch zmiany aktywnej zakładki; zwraca funkcję wypisującą. */
    onDidChangeActiveTab(callback: (tab: AktywnaZakladka | null) => void): () => void;
    /** Otwiera terminal we wskazanym katalogu (wymaga uprawnienia terminal.write). */
    openTerminal(cwd: string, label?: string): Promise<void>;
  };

  ui: {
    /**
     * Ustawia (albo aktualizuje) element paska statusu. `command` musi być zadeklarowana
     * w manifeście — element jest klikalny i nie może uruchomić czegoś spoza kontraktu.
     */
    setStatusBarItem(item: { id: string; text: string; tooltip?: string; command?: string }): Promise<void>;
    removeStatusBarItem(id: string): Promise<void>;
    /**
     * Wystawia drzewo pod widokiem zadeklarowanym w manifeście. Aplikacja pyta o dzieci
     * dopiero wtedy, gdy użytkownik rozwinie węzeł — całe drzewo nigdy nie jest budowane
     * z góry.
     */
    registerTreeDataProvider(viewId: string, provider: DostawcaDrzewa): Promise<void>;
    /** Mówi aplikacji, że zawartość widoku się zmieniła i trzeba ją wczytać ponownie. */
    refreshView(viewId: string): Promise<void>;
    /** Wysyła wiadomość do własnej strony widoku (`type: "webview"`). */
    postToView(viewId: string, payload: unknown): Promise<void>;
    /** Nasłuch wiadomości OD strony widoku; zwraca funkcję wypisującą. */
    onViewMessage(viewId: string, callback: (payload: unknown) => void): () => void;
  };

  terminal: {
    /** Otwarte sesje (uprawnienie terminal.read). */
    list(): Promise<Array<{ sessionId: string; label: string; kind: string }>>;
    /** Ostatnie wiersze wyjścia sesji, bez sekwencji sterujących (terminal.read). */
    readRecent(sessionId: string, lines?: number): Promise<string>;
    /** Wysyła tekst do sesji, tak jakby wpisał go użytkownik (terminal.write). */
    write(sessionId: string, data: string): Promise<void>;
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
  const komendy = new Map<string, (nodeId?: string) => unknown | Promise<unknown>>();
  /** Dostawcy drzew pod identyfikatorami widoków. */
  const drzewa = new Map<string, DostawcaDrzewa>();
  /** Nasłuchy wiadomości ze stron widoków (webview). */
  const odbiorcyWidokow = new Map<string, Array<(payload: unknown) => void>>();

  naZadanie('view.message', (params) => {
    const p = params as { viewId?: string; payload?: unknown } | undefined;
    for (const cb of odbiorcyWidokow.get(p?.viewId ?? '') ?? []) {
      try {
        cb(p?.payload);
      } catch (error) {
        console.error('[wtyczka] błąd obsługi wiadomości z widoku:', error);
      }
    }
    return true;
  });

  naZadanie('command.invoke', async (params) => {
    const p = params as { commandId?: string; nodeId?: string } | undefined;
    const handler = p?.commandId ? komendy.get(p.commandId) : undefined;
    if (!handler) throw new Error(`komenda ${String(p?.commandId)} nie jest zarejestrowana`);
    await handler(p?.nodeId);
    return true;
  });

  naZadanie('view.getChildren', async (params) => {
    const p = params as { viewId?: string; nodeId?: string | null } | undefined;
    const provider = p?.viewId ? drzewa.get(p.viewId) : undefined;
    if (!provider) throw new Error(`widok ${String(p?.viewId)} nie ma dostawcy danych`);
    const dzieci = await provider.getChildren(p?.nodeId ?? null);
    return Array.isArray(dzieci) ? dzieci : [];
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
        naZdarzenie('workspace.activeTabChanged', (payload) => callback(payload as AktywnaZakladka | null)),
      openTerminal: async (cwd, label) => {
        await wywolaj('workspace.openTerminal', label === undefined ? { cwd } : { cwd, label });
      }
    },

    ui: {
      async setStatusBarItem(item) {
        await wywolaj('ui.statusBar.set', item);
      },
      async removeStatusBarItem(id) {
        await wywolaj('ui.statusBar.remove', { id });
      },
      async registerTreeDataProvider(viewId, provider) {
        drzewa.set(viewId, provider);
        await wywolaj('ui.views.register', { viewId });
      },
      async refreshView(viewId) {
        await wywolaj('ui.views.refresh', { viewId });
      },
      async postToView(viewId, payload) {
        await wywolaj('ui.views.post', { viewId, payload });
      },
      onViewMessage(viewId, callback) {
        const lista = odbiorcyWidokow.get(viewId) ?? [];
        lista.push(callback);
        odbiorcyWidokow.set(viewId, lista);
        return () => {
          const biezaca = odbiorcyWidokow.get(viewId);
          const i = biezaca?.indexOf(callback) ?? -1;
          if (biezaca && i !== -1) biezaca.splice(i, 1);
        };
      }
    },

    terminal: {
      list: () =>
        wywolaj('terminal.list') as Promise<Array<{ sessionId: string; label: string; kind: string }>>,
      readRecent: (sessionId, lines = 50) =>
        wywolaj('terminal.read', { sessionId, lines }) as Promise<string>,
      write: async (sessionId, data) => {
        await wywolaj('terminal.write', { sessionId, data });
      }
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
