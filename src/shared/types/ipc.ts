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

export interface TerminalCreateRequest {
  columns: number;
  rows: number;
}

export interface TerminalCreateResult {
  sessionId: string;
  shell: string;
}

export interface TerminalWriteRequest {
  sessionId: string;
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
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number;
}
