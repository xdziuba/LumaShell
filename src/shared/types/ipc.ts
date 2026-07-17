/**
 * Kontrakt IPC współdzielony przez main, preload i renderer.
 *
 * Jedno źródło prawdy dla nazw kanałów i kształtu ładunków. Renderer nigdy nie sięga
 * do zasobów bezpośrednio — wszystko przechodzi tędy (docs/security/01-model-procesow.md).
 */

/**
 * Kanały wywoływane przez renderer (żądanie → odpowiedź).
 *
 * Brak kanałów sterowania oknem jest celowy — przyciski okna są natywne
 * (docs/architecture/10-decyzje.md).
 */
export const IpcChannel = {
  AppCapabilities: 'app:capabilities',
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',
  ProfilesList: 'profiles:list',
  ProfilesSave: 'profiles:save',
  ProfilesDelete: 'profiles:delete',
  ThemesGet: 'themes:get',
  ThemeSelect: 'themes:select',
  ThemeSave: 'themes:save',
  ThemeDelete: 'themes:delete',
  ThemeImport: 'themes:import',
  ThemeExport: 'themes:export',
  ThemePickWallpaper: 'themes:pickWallpaper',
  WorkspaceGet: 'workspace:get',
  WorkspaceSave: 'workspace:save',
  ShellList: 'shell:list',
  SerialListPorts: 'serial:listPorts',
  SshConnect: 'ssh:connect',
  SshHostVerifyResponse: 'ssh:hostVerifyResponse',
  SftpRealpath: 'sftp:realpath',
  SftpList: 'sftp:list',
  SftpDownload: 'sftp:download',
  SftpUpload: 'sftp:upload',
  SessionLogStart: 'sessionLog:start',
  SessionLogStop: 'sessionLog:stop',
  PluginCommands: 'plugin:commands',
  PluginRunCommand: 'plugin:runCommand',
  TerminalCreate: 'terminal:create',
  TerminalWrite: 'terminal:write',
  TerminalResize: 'terminal:resize',
  TerminalDispose: 'terminal:dispose'
} as const;

/** Kanały wypychane z main do renderera (zdarzenia). */
export const IpcEvent = {
  TerminalData: 'terminal:data',
  TerminalExit: 'terminal:exit',
  SshHostVerify: 'ssh:hostVerify',
  PluginCommandsChanged: 'plugin:commandsChanged',
  PluginNotification: 'plugin:notification'
} as const;

/** Komenda wystawiona przez wtyczkę, widoczna w palecie. */
export interface PluginCommand {
  pluginId: string;
  id: string;
  title: string;
}

/** Powiadomienie od wtyczki (po sprawdzeniu uprawnienia notifications.show). */
export interface PluginNotification {
  pluginName: string;
  level: string;
  message: string;
}

/**
 * Możliwości środowiska ustalane w procesie głównym.
 *
 * Renderer NIE wykrywa wersji systemu samodzielnie — dostaje gotową flagę
 * (docs/architecture/03-interfejs-i-motywy.md#degradacja-na-windows-10).
 */
/**
 * Odpowiednik `NodeJS.Platform`, powtórzony celowo.
 *
 * `shared` jest współdzielone z rendererem, który nie ma typów Node.js — sięgnięcie
 * po `NodeJS.*` zerwałoby granicę procesów (docs/security/01-model-procesow.md).
 */
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd';

export interface AppCapabilities {
  /** Czy okno ma włączone systemowe rozmycie tła (Windows 11 22H2+). */
  acrylic: boolean;
  platform: Platform;
  /** Numer builda systemu; 0 gdy nieustalony lub poza Windows. */
  osBuild: number;
}

/**
 * Czego dotyczy sesja.
 *
 * Renderer prosi o rodzaj połączenia, nie o konkretną bibliotekę — po drugiej stronie
 * stoi odpowiedni `TerminalTransport` (docs/architecture/02-warstwy-i-transporty.md).
 */
/** Tryb monitora portu szeregowego: widok hex i/lub znaczniki czasu. */
export interface MonitorMode {
  hex: boolean;
  timestamps: boolean;
}

/** Parametry ramki portu szeregowego. */
export interface SerialFraming {
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  /** Sprzętowa kontrola przepływu RTS/CTS. */
  rtscts?: boolean;
}

export type SessionSpec =
  /** `shellId` pochodzi z listy wykrytych powłok; brak = powłoka domyślna. */
  | { kind: 'pty'; shellId?: string; cwd?: string }
  | ({ kind: 'serial'; path: string; baudRate: number } & SerialFraming)
  /**
   * `connectionId` wskazuje deskryptor SSH żyjący w procesie głównym — poświadczenia
   * NIGDY nie przechodzą przez SessionSpec ani snapshot (docs/security/02-sekrety.md).
   */
  | { kind: 'ssh'; connectionId: string; label: string };

/** Metoda uwierzytelniania SSH. */
export type SshAuthMethod = 'password' | 'key' | 'agent';

/**
 * Żądanie połączenia SSH z renderera.
 *
 * Sekrety (hasło, hasło klucza) idą tędy raz, do procesu głównego, który trzyma je
 * ulotnie w pamięci i nie zwraca ich rendererowi ani nie zapisuje na dysk.
 */
export interface SshConnectRequest {
  host: string;
  port: number;
  username: string;
  auth: SshAuthMethod;
  password?: string;
  /** Ścieżka do pliku klucza prywatnego (auth = 'key'). */
  keyPath?: string;
  passphrase?: string;
  /** Host pośredniczący (bastion). Ma własne poświadczenia i weryfikację klucza. */
  jump?: {
    host: string;
    port: number;
    username: string;
    auth: SshAuthMethod;
    password?: string;
    keyPath?: string;
    passphrase?: string;
  };
  /** Lokalne przekierowania portów (-L). */
  localForwards?: Array<{ localPort: number; destHost: string; destPort: number }>;
}

/** Wpis w zdalnym katalogu (SFTP). */
export interface SftpEntry {
  name: string;
  type: 'dir' | 'file' | 'other';
  size: number;
}

/** Prośba o weryfikację klucza hosta wysyłana do renderera w trakcie handshake'u. */
export interface HostVerifyRequest {
  requestId: string;
  host: string;
  port: number;
  fingerprint: string;
  /** 'unknown' — pierwszy kontakt (TOFU); 'changed' — odcisk się zmienił (możliwy MITM). */
  reason: 'unknown' | 'changed';
}

/** Powłoka wykryta w systemie, w postaci widocznej dla renderera. */
export interface ShellInfo {
  id: string;
  label: string;
}

/**
 * Zapisany panel w drzewie zakładki.
 *
 * Rekurencyjna struktura odpowiada `Pane` z core: liść niesie `spec` i `label`, split ma
 * kierunek, udział i dwoje dzieci. Trzymana w `shared`, bo przechodzi przez IPC.
 */
export type StoredPane =
  | { kind: 'leaf'; spec: SessionSpec; label: string }
  | { kind: 'split'; direction: 'row' | 'column'; ratio: number; a: StoredPane; b: StoredPane };

/** Pojedyncza zakładka w zapisanym workspace — całe drzewo paneli. */
export interface WorkspaceTab {
  root: StoredPane;
  /** Indeks aktywnego liścia w kolejności od lewej/góry. */
  activeLeafIndex: number;
}

/**
 * Zapamiętany układ zakładek.
 *
 * Przywracane są wyłącznie sesje powłok — port szeregowy jest pomijany, bo jego
 * automatyczne otwarcie przestawia linie sterujące i może zresetować urządzenie
 * (docs/security/03-polityka-agenta.md). Serial jest przycinany z drzewa przy zapisie.
 */
export interface WorkspaceSnapshot {
  tabs: WorkspaceTab[];
  activeIndex: number;
}

export interface TerminalCreateRequest {
  spec: SessionSpec;
  columns: number;
  rows: number;
}

export interface TerminalCreateResult {
  sessionId: string;
  /** Etykieta do pokazania użytkownikowi, np. „Windows PowerShell" albo „COM9 @ 115200". */
  label: string;
}

export interface TerminalWriteRequest {
  sessionId: string;
  /** Wejście z klawiatury jest tekstem; wysyłka binarna i hex wchodzą w Etapie 4. */
  data: string;
}

export interface TerminalResizeRequest {
  sessionId: string;
  columns: number;
  rows: number;
}

export interface TerminalDisposeRequest {
  sessionId: string;
}

export interface TerminalDataEvent {
  sessionId: string;
  /** Surowe bajty — dekoduje dopiero xterm (patrz core/transports/transport.ts). */
  data: Uint8Array;
}

export interface TerminalExitEvent {
  sessionId: string;
  /** Tylko dla sesji, które mają pojęcie kodu wyjścia (PTY). Port szeregowy go nie ma. */
  exitCode?: number;
}
