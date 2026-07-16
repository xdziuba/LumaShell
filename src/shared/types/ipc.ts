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
  SerialListPorts: 'serial:listPorts',
  TerminalCreate: 'terminal:create',
  TerminalWrite: 'terminal:write',
  TerminalResize: 'terminal:resize',
  TerminalDispose: 'terminal:dispose'
} as const;

/** Kanały wypychane z main do renderera (zdarzenia). */
export const IpcEvent = {
  TerminalData: 'terminal:data',
  TerminalExit: 'terminal:exit'
} as const;

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
export type SessionSpec =
  | { kind: 'pty' }
  | { kind: 'serial'; path: string; baudRate: number };

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
