/**
 * Kontrakt API wystawianego rendererowi przez preload.
 *
 * Mieszka w `shared`, żeby renderer mógł znać kształt API bez importowania preloadu
 * (a przez niego `electron`). Preload ten kontrakt implementuje, renderer go konsumuje.
 */

import type {
  AiActionLog,
  AiChatDeltaEvent,
  AiChatRequest,
  AiChatResult,
  AiCliAvailability,
  AiPolicy,
  AppCapabilities,
  ContainerInfo,
  HostVerifyRequest,
  InstalledPlugin,
  PluginCommand,
  PluginNotification,
  PluginToolInfo,
  SessionSpec,
  ShellInfo,
  SftpEntry,
  SshConnectRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  UserDirs,
  WhatsNewEntry,
  WorkspaceSnapshot
} from './ipc';
import type { SerialPortInfo } from '@core/transports/transport';
import type { Profile } from '@core/profiles/profile';
import type { Theme } from '@core/theme/theme';
import type { AiConfig, AiModel } from '@core/ai/provider';
import type { TerminalSettings } from './settings';

/** Każdy nasłuch zwraca funkcję wypisującą. */
export type Unsubscribe = () => void;

export interface LumaApi {
  getCapabilities(): Promise<AppCapabilities>;

  /** Sterowanie oknem — własne przyciski (kółka) zamiast natywnego WCO. */
  window: {
    minimize(): void;
    maximizeToggle(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChanged(callback: (maximized: boolean) => void): Unsubscribe;
  };

  /** Powłoki wykryte w systemie. */
  listShells(): Promise<ShellInfo[]>;

  settings: {
    get(): Promise<TerminalSettings>;
    /** Zwraca ustawienia po walidacji — mogą różnić się od wysłanych, jeśli były poza zakresem. */
    save(settings: TerminalSettings): Promise<TerminalSettings>;
  };

  profiles: {
    list(): Promise<Profile[]>;
    /** Wstawia lub nadpisuje profil po id; zwraca pełną listę. */
    save(profile: Profile): Promise<Profile[]>;
    delete(id: string): Promise<Profile[]>;
  };

  themes: {
    /** Lista motywów (wbudowane + własne) oraz id aktywnego. */
    get(): Promise<{ themes: Theme[]; selectedId: string }>;
    select(id: string): Promise<void>;
    save(theme: Theme): Promise<Theme[]>;
    delete(id: string): Promise<Theme[]>;
    /** Import z pliku (dialog); zwraca nową listę albo null przy anulowaniu. */
    import(): Promise<Theme[] | null>;
    /** Eksport motywu do pliku (dialog); `true`, gdy zapisano. */
    export(theme: Theme): Promise<boolean>;
    /** Wybór obrazu tapety (dialog); zwraca data URL albo null. */
    pickWallpaper(): Promise<string | null>;
  };

  dialogs: {
    /** Natywne okno wyboru katalogu; zwraca ścieżkę albo null przy anulowaniu. */
    pickDirectory(defaultPath?: string): Promise<string | null>;
  };

  workspace: {
    /** Zapamiętany układ zakładek; puste `tabs`, gdy nic nie zapisano. */
    get(): Promise<WorkspaceSnapshot>;
    save(snapshot: WorkspaceSnapshot): Promise<void>;
  };

  serial: {
    /** Wyłącznie odczyt listy — nie otwiera żadnego portu. */
    listPorts(): Promise<SerialPortInfo[]>;
  };

  containers: {
    /** Wykrywa kontenery Docker i pody K8s; pusto, gdy brak CLI. Niczego nie uruchamia. */
    list(): Promise<ContainerInfo[]>;
  };

  ssh: {
    /** Rejestruje połączenie (sekrety zostają w procesie głównym); zwraca connectionId. */
    connect(request: SshConnectRequest): Promise<{ connectionId: string; label: string }>;
    /** Prośba o weryfikację klucza hosta w trakcie łączenia. */
    onHostVerify(callback: (request: HostVerifyRequest) => void): Unsubscribe;
    respondHostVerify(requestId: string, accepted: boolean): void;
  };

  /** Zapis surowych danych sesji do pliku. */
  sessionLog: {
    /** Pokazuje dialog zapisu i zaczyna log; `true`, gdy uruchomiono. */
    start(sessionId: string): Promise<boolean>;
    stop(sessionId: string): Promise<boolean>;
  };

  plugins: {
    /** Komendy wystawione przez wtyczki (do palety). */
    commands(): Promise<PluginCommand[]>;
    runCommand(pluginId: string, commandId: string): void;
    onCommandsChanged(callback: (commands: PluginCommand[]) => void): Unsubscribe;
    onNotification(callback: (n: PluginNotification) => void): Unsubscribe;
    /** Lista zainstalowanych wtyczek (do menedżera). */
    installed(): Promise<InstalledPlugin[]>;
    /** Włącza/wyłącza wtyczkę; zwraca zaktualizowaną listę. */
    setEnabled(id: string, enabled: boolean): Promise<InstalledPlugin[]>;
    onPluginsChanged(callback: (plugins: InstalledPlugin[]) => void): Unsubscribe;
    /** Narzędzia AI wystawione przez wtyczki (AI-6) — do scalenia z wbudowanymi. */
    listTools(): Promise<PluginToolInfo[]>;
    /** Wywołuje narzędzie wtyczki i zwraca jego wynik jako tekst (albo rzuca). */
    runTool(pluginId: string, toolId: string, args: Record<string, unknown>): Promise<string>;
    onToolsChanged(callback: (tools: PluginToolInfo[]) => void): Unsubscribe;
    /** Ponowny skan katalogów wtyczek — bez restartu aplikacji. */
    rescan(): Promise<InstalledPlugin[]>;
  };

  paths: {
    /** Ścieżki katalogów użytkownika (wtyczki, motywy, logi) do pokazania w UI. */
    get(): Promise<UserDirs>;
    /** Otwiera katalog w eksploratorze; renderer podaje rodzaj, nie ścieżkę. */
    open(kind: keyof UserDirs): void;
  };

  /** Nowości/zmiany aplikacji — pobierane z GitHuba, z lokalnym fallbackiem. */
  whatsNew(): Promise<WhatsNewEntry[]>;

  /** Konfiguracja dostawcy AI (AI-0). Klucz zostaje w procesie głównym. */
  ai: {
    getConfig(): Promise<AiConfig>;
    /** `apiKey`: pomiń = bez zmiany, '' = usuń, wartość = zapisz. Zwraca config po walidacji. */
    saveConfig(config: Pick<AiConfig, 'provider' | 'baseUrl' | 'model'>, apiKey?: string): Promise<AiConfig>;
    listModels(): Promise<AiModel[]>;
    /** Test połączenia — rzuca czytelnym błędem albo zwraca liczbę modeli. */
    testConnection(): Promise<{ ok: true; models: number }>;
    /** Które oficjalne CLI AI (Codex/Claude Code) są w PATH — do szybkiego startu w sesji. */
    detectClis(): Promise<AiCliAvailability>;
    /**
     * Jedna tura czatu. Delty tekstu przychodzą przez `onChatDelta` (po requestId), a
     * obietnica zwraca tekst + wywołania narzędzi (pętlę narzędzi prowadzi renderer).
     * Klucz i wybór modelu zostają w main.
     */
    chat(request: AiChatRequest): Promise<AiChatResult>;
    /** Przerywa trwające żądanie czatu o danym requestId (przycisk „stop"). */
    cancelChat(requestId: string): void;
    /** Nasłuch porcji strumienia odpowiedzi. */
    onChatDelta(callback: (event: AiChatDeltaEvent) => void): Unsubscribe;
    /** Dialog wyboru pliku tekstowego do dołączenia jako kontekst; null przy anulowaniu. */
    pickTextFile(): Promise<{ name: string; content: string } | null>;
    /** Zapisuje plik (akcja AI-3 — już zatwierdzona w UI); zwraca skutek. */
    writeFile(path: string, content: string): Promise<{ ok: boolean; message: string }>;
    /** Dopisuje wpis do dziennika audytowego działań AI. */
    logAction(entry: AiActionLog): void;
    /** Polityka autonomii agenta (AI-7) — limity biegu. */
    getPolicy(): Promise<AiPolicy>;
    /** Zapisuje politykę po walidacji; zwraca wartości faktycznie utrwalone. */
    savePolicy(policy: AiPolicy): Promise<AiPolicy>;
  };

  /** Diagnostyka i zgłaszanie problemów (lokalny log, bez telemetrii). */
  diagnostics: {
    /** Otwiera katalog logów w eksploratorze. */
    openLogs(): void;
    /** Otwiera formularz zgłoszenia błędu na GitHubie (z wersją i systemem). */
    reportProblem(): void;
    /** Zapisuje błąd renderera do logu (używane przez ErrorBoundary). */
    reportError(message: string): void;
  };

  /** SFTP działa na istniejącej sesji SSH (po jej sessionId). */
  sftp: {
    realpath(sessionId: string, path: string): Promise<string>;
    list(sessionId: string, path: string): Promise<SftpEntry[]>;
    /** Pobiera plik zdalny; pokazuje dialog zapisu. `true`, gdy zapisano. */
    download(sessionId: string, path: string): Promise<boolean>;
    /** Wysyła wybrany plik lokalny do katalogu zdalnego; zwraca nazwę albo null. */
    upload(sessionId: string, dir: string): Promise<string | null>;
  };

  terminal: {
    create(spec: SessionSpec, columns: number, rows: number): Promise<TerminalCreateResult>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, columns: number, rows: number): Promise<void>;
    dispose(sessionId: string): Promise<void>;
    onData(callback: (event: TerminalDataEvent) => void): Unsubscribe;
    onExit(callback: (event: TerminalExitEvent) => void): Unsubscribe;
  };
}
