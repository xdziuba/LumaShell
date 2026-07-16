/**
 * Kontrakt API wystawianego rendererowi przez preload.
 *
 * Mieszka w `shared`, żeby renderer mógł znać kształt API bez importowania preloadu
 * (a przez niego `electron`). Preload ten kontrakt implementuje, renderer go konsumuje.
 */

import type {
  AppCapabilities,
  SessionSpec,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent
} from './ipc';
import type { SerialPortInfo } from '@core/transports/transport';

/** Każdy nasłuch zwraca funkcję wypisującą. */
export type Unsubscribe = () => void;

export interface LumaApi {
  getCapabilities(): Promise<AppCapabilities>;

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
