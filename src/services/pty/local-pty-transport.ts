/**
 * Implementacja `TerminalTransport` oparta na node-pty / ConPTY.
 *
 * Ten plik należy do `services` — tu wolno sięgać do zależności natywnych.
 * Zależność idzie wyłącznie w stronę `core` (docs/architecture/06-struktura-projektu.md).
 */

import { spawn, type IPty } from 'node-pty';
import type {
  ConnectionState,
  LocalPtyOptions,
  TerminalTransport
} from '@core/transports/transport';

export class LocalPtyTransport implements TerminalTransport {
  readonly type = 'local-pty';

  #pty: IPty | undefined;
  #state: ConnectionState = 'idle';
  #dataHandlers: Array<(data: string) => void> = [];
  #stateHandlers: Array<(state: ConnectionState) => void> = [];
  #errorHandlers: Array<(error: Error) => void> = [];
  #exitHandlers: Array<(exitCode: number) => void> = [];

  constructor(
    readonly id: string,
    private readonly options: LocalPtyOptions
  ) {}

  get state(): ConnectionState {
    return this.#state;
  }

  get shell(): string {
    return this.options.shell;
  }

  async connect(): Promise<void> {
    if (this.#pty) return;
    this.#setState('connecting');

    try {
      this.#pty = spawn(this.options.shell, this.options.args ?? [], {
        name: 'xterm-256color',
        cols: this.options.columns ?? 80,
        rows: this.options.rows ?? 24,
        cwd: this.options.cwd ?? process.env.USERPROFILE ?? process.cwd(),
        env: this.options.env ?? (process.env as Record<string, string>),
        useConpty: true
      });
    } catch (error) {
      this.#setState('error');
      this.#emitError(error);
      throw error;
    }

    this.#pty.onData((data) => {
      for (const handler of this.#dataHandlers) handler(data);
    });

    this.#pty.onExit(({ exitCode }) => {
      this.#pty = undefined;
      this.#setState('closed');
      for (const handler of this.#exitHandlers) handler(exitCode);
    });

    this.#setState('connected');
  }

  async disconnect(): Promise<void> {
    if (!this.#pty) return;
    try {
      this.#pty.kill();
    } catch {
      // PTY mógł już zniknąć wraz z powłoką — nie jest to błąd.
    }
    this.#pty = undefined;
    this.#setState('closed');
  }

  async write(data: string): Promise<void> {
    this.#pty?.write(data);
  }

  async resize(columns: number, rows: number): Promise<void> {
    try {
      this.#pty?.resize(columns, rows);
    } catch (error) {
      // Wyścig przy zamykaniu powłoki: renderer zdążył wysłać resize do martwego PTY.
      this.#emitError(error);
    }
  }

  onData(callback: (data: string) => void): void {
    this.#dataHandlers.push(callback);
  }

  onStateChange(callback: (state: ConnectionState) => void): void {
    this.#stateHandlers.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.#errorHandlers.push(callback);
  }

  /** Kod wyjścia powłoki. Można rejestrować przed `connect()`. */
  onExit(callback: (exitCode: number) => void): void {
    this.#exitHandlers.push(callback);
  }

  #setState(state: ConnectionState): void {
    this.#state = state;
    for (const handler of this.#stateHandlers) handler(state);
  }

  #emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    for (const handler of this.#errorHandlers) handler(normalized);
  }
}
