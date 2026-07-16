/**
 * Kontrakt transportu terminala.
 *
 * Ten plik należy do `core` — definiuje wyłącznie kontrakty i nie może importować
 * zależności natywnych ani API Node.js. Implementacje żyją w `services`
 * (docs/architecture/06-struktura-projektu.md).
 */

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export interface TerminalTransport {
  readonly id: string;
  readonly type: string;
  readonly state: ConnectionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: string): Promise<void>;
  resize?(columns: number, rows: number): Promise<void>;

  onData(callback: (data: string) => void): void;
  onStateChange(callback: (state: ConnectionState) => void): void;
  onError(callback: (error: Error) => void): void;
}

/** Opcje uruchomienia lokalnej powłoki przez PTY. */
export interface LocalPtyOptions {
  shell: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  columns?: number;
  rows?: number;
}
