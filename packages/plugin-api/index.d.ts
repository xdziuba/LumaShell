/**
 * Typy Plugin API LumaShella (v2).
 *
 * Celem tej paczki jest jedno: żeby dało się napisać wtyczkę BEZ czytania kodu LumaShella.
 * Nie ma tu żadnej implementacji — obiekt `context` dostaje wtyczka od aplikacji, a te typy
 * tylko opisują jego kształt.
 *
 * Użycie w czystym JavaScripcie (bez kroku budowania):
 *
 * ```js
 * /** @type {import('@lumashell/plugin-api').Activate} *\/
 * exports.activate = async (ctx) => { ... };
 * ```
 */

/** Zwięzły opis aktywnej zakładki. */
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

export interface SesjaTerminala {
  sessionId: string;
  label: string;
  kind: string;
}

/**
 * Węzeł drzewa oddawany aplikacji.
 *
 * Bez HTML-a i stylów — rysuje LumaShell, w swoim motywie. `id` warto zrobić czymś
 * użytecznym (np. ścieżką), bo trafia do komendy węzła jako argument.
 */
export interface WezelDrzewa {
  id: string;
  label: string;
  description?: string;
  /** Czy węzeł da się rozwinąć (aplikacja pokaże strzałkę i dopiero wtedy zapyta o dzieci). */
  expandable?: boolean;
  /** Komenda wtyczki wołana po dwukliku; musi być zadeklarowana w manifeście. */
  command?: string;
}

/** Dostawca zawartości drzewa. `nodeId === null` oznacza korzeń. */
export interface DostawcaDrzewa {
  getChildren(nodeId: string | null): WezelDrzewa[] | Promise<WezelDrzewa[]>;
}

export interface ElementPaskaStatusu {
  id: string;
  /** Do 40 znaków. Obok aplikacja i tak pokaże nazwę wtyczki. */
  text: string;
  tooltip?: string;
  /** Komenda uruchamiana po kliknięciu; musi być zadeklarowana w manifeście. */
  command?: string;
}

/**
 * Kontekst wtyczki — jedyne wejście do aplikacji.
 *
 * Każde wywołanie przechodzi przez bramkę uprawnień w procesie głównym i MA odpowiedź:
 * brak uprawnienia to odrzucona obietnica z kodem `EPERM`, a nie ciche nic.
 */
export interface LumaContext {
  readonly pluginId: string;
  /** Uprawnienia przyznane wtyczce (do wglądu — egzekwuje je aplikacja, nie ten obiekt). */
  readonly permissions: string[];
  /** Log wtyczki: trafia do `userData/logs/plugins/<id>.log`. */
  log(...args: unknown[]): void;

  app: {
    getInfo(): Promise<InfoAplikacji>;
  };

  commands: {
    /**
     * Rejestruje obsługę komendy zadeklarowanej w `contributes.commands`.
     * `nodeId` jest podawany, gdy komendę uruchomiono z węzła drzewa.
     */
    registerCommand(commandId: string, handler: (nodeId?: string) => unknown | Promise<unknown>): Promise<void>;
  };

  notifications: {
    show(message: string, level?: 'info' | 'warn' | 'error'): Promise<void>;
  };

  workspace: {
    getActiveTab(): Promise<AktywnaZakladka | null>;
    /** Zwraca funkcję wypisującą nasłuch. */
    onDidChangeActiveTab(callback: (tab: AktywnaZakladka | null) => void): () => void;
    /** Wymaga uprawnienia `terminal.write`. */
    openTerminal(cwd: string, label?: string): Promise<void>;
  };

  terminal: {
    /** Wymaga `terminal.read`. */
    list(): Promise<SesjaTerminala[]>;
    /** Ostatnie wiersze wyjścia, bez sekwencji sterujących. Wymaga `terminal.read`. */
    readRecent(sessionId: string, lines?: number): Promise<string>;
    /** Wysyła tekst do sesji, tak jakby wpisał go użytkownik. Wymaga `terminal.write`. */
    write(sessionId: string, data: string): Promise<void>;
  };

  ui: {
    /** Wymaga `ui.statusBar`. */
    setStatusBarItem(item: ElementPaskaStatusu): Promise<void>;
    removeStatusBarItem(id: string): Promise<void>;
    /**
     * Wystawia drzewo pod widokiem zadeklarowanym w manifeście (`contributes.views`).
     * Aplikacja pyta o dzieci dopiero przy rozwinięciu węzła. Wymaga `ui.views`.
     */
    registerTreeDataProvider(viewId: string, provider: DostawcaDrzewa): Promise<void>;
    /** Każe aplikacji wczytać widok od nowa. */
    refreshView(viewId: string): Promise<void>;
    /** Wysyła wiadomość do własnej strony widoku (`type: "webview"`). */
    postToView(viewId: string, payload: unknown): Promise<void>;
    /** Nasłuch wiadomości OD strony widoku; zwraca funkcję wypisującą. */
    onViewMessage(viewId: string, callback: (payload: unknown) => void): () => void;
  };

  /** Trwały magazyn wtyczki: jeden plik JSON w `userData/plugins-data/<id>.json`. */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    /** Ścieżka pliku — do pokazania użytkownikowi, gdy ma coś w nim ustawić. */
    path(): Promise<string>;
  };
}

/** Wywoływane przy starcie wtyczki. */
export type Activate = (context: LumaContext) => unknown | Promise<unknown>;

/**
 * Wywoływane przy zatrzymaniu. Wtyczka dostaje ~2 sekundy na uprzątnięcie po sobie —
 * potem jej proces jest kończony, więc to jest uprzejmość, a nie gwarancja.
 */
export type Deactivate = () => unknown | Promise<unknown>;

/** Kody błędów odrzuconych obietnic (pole `code`). */
export type KodBleduRpc = 'EPERM' | 'ENOTSUP' | 'EINVAL' | 'ENOENT' | 'ETIMEDOUT' | 'EFAIL';
