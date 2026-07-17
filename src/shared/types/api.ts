/**
 * Kontrakt API wystawianego rendererowi przez preload.
 *
 * Mieszka w `shared`, żeby renderer mógł znać kształt API bez importowania preloadu
 * (a przez niego `electron`). Preload ten kontrakt implementuje, renderer go konsumuje.
 */

import type {
  AppCapabilities,
  HostVerifyRequest,
  SessionSpec,
  ShellInfo,
  SftpEntry,
  SshConnectRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  WorkspaceSnapshot
} from './ipc';
import type { SerialPortInfo } from '@core/transports/transport';
import type { Profile } from '@core/profiles/profile';
import type { TerminalSettings } from './settings';

/** Każdy nasłuch zwraca funkcję wypisującą. */
export type Unsubscribe = () => void;

export interface LumaApi {
  getCapabilities(): Promise<AppCapabilities>;

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

  workspace: {
    /** Zapamiętany układ zakładek; puste `tabs`, gdy nic nie zapisano. */
    get(): Promise<WorkspaceSnapshot>;
    save(snapshot: WorkspaceSnapshot): Promise<void>;
  };

  serial: {
    /** Wyłącznie odczyt listy — nie otwiera żadnego portu. */
    listPorts(): Promise<SerialPortInfo[]>;
  };

  ssh: {
    /** Rejestruje połączenie (sekrety zostają w procesie głównym); zwraca connectionId. */
    connect(request: SshConnectRequest): Promise<{ connectionId: string; label: string }>;
    /** Prośba o weryfikację klucza hosta w trakcie łączenia. */
    onHostVerify(callback: (request: HostVerifyRequest) => void): Unsubscribe;
    respondHostVerify(requestId: string, accepted: boolean): void;
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
