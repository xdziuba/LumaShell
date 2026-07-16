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
  #dataHandlers: Array<(data: Uint8Array) => void> = [];
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
        // Opcji `encoding` celowo tu nie ma. Na Windows node-pty ją ignoruje i wypisuje
        // „Setting encoding on Windows is not supported" — ścieżka ConPTY zawsze oddaje
        // string, nigdy Buffer. Sprawdzone dla null, undefined i 'utf8'.
      });
    } catch (error) {
      this.#setState('error');
      this.#emitError(error);
      throw error;
    }

    // Kontrakt transportu mówi bajtami, a ConPTY oddaje wyłącznie string, więc tekst
    // wraca tu do UTF-8.
    //
    // To nie jest strata: node-pty zdekodował już wyjście na swoim poziomie, więc
    // ewentualne bajty spoza UTF-8 przepadły zanim tu dotarły — ponowne kodowanie
    // niczego do tego nie dokłada. Jednolity kontrakt jest wart tego kosztu, bo dzięki
    // niemu port szeregowy i SSH zostają naprawdę binarne.
    this.#pty.onData((data) => {
      const bytes = Buffer.from(data, 'utf8');
      for (const handler of this.#dataHandlers) handler(bytes);
    });

    this.#pty.onExit(({ exitCode }) => {
      this.#pty = undefined;
      // Kod wyjścia najpierw, dopiero potem zmiana stanu: obserwator stanu 'closed'
      // musi już znać kod, bo to on rozgłasza koniec sesji.
      for (const handler of this.#exitHandlers) handler(exitCode);
      this.#setState('closed');
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

  async write(data: string | Uint8Array): Promise<void> {
    if (!this.#pty) return;
    // W drugą stronę tak samo: ConPTY przyjmuje tekst, więc bajty trzeba zdekodować.
    this.#pty.write(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
  }

  async resize(columns: number, rows: number): Promise<void> {
    try {
      this.#pty?.resize(columns, rows);
    } catch (error) {
      // Wyścig przy zamykaniu powłoki: renderer zdążył wysłać resize do martwego PTY.
      this.#emitError(error);
    }
  }

  onData(callback: (data: Uint8Array) => void): void {
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
