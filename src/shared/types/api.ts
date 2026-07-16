/**
 * Kontrakt API wystawianego rendererowi przez preload.
 *
 * Mieszka w `shared`, żeby renderer mógł znać kształt API bez importowania preloadu
 * (a przez niego `electron`). Preload ten kontrakt implementuje, renderer go konsumuje.
 */

import type {
  AppCapabilities,
  SessionSpec,
  ShellInfo,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent
} from './ipc';
import type { SerialPortInfo } from '@core/transports/transport';
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

  serial: {
    /** Wyłącznie odczyt listy — nie otwiera żadnego portu. */
    listPorts(): Promise<SerialPortInfo[]>;
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
