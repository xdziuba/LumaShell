/**
 * Implementacja `TerminalTransport` dla surowego TCP oraz TCP+TLS (Etap 7).
 *
 * Jedna klasa obsługuje oba warianty, bo TLS to TCP z warstwą szyfrowania — różni je
 * wyłącznie sposób nawiązania gniazda. Strumień idzie do terminala bez dekodowania
 * (kontrakt bajtowy), więc równie dobrze obsłuży protokół tekstowy jak binarny.
 */

import { Socket, connect as netConnect } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type {
  ConnectionState,
  NetworkOptions,
  TerminalTransport
} from '@core/transports/transport';
import { notice, okNotice } from './notice.ts';

export class TcpTransport implements TerminalTransport {
  readonly type: string;

  #socket: Socket | TLSSocket | undefined;
  #state: ConnectionState = 'idle';
  #dataHandlers: Array<(data: Uint8Array) => void> = [];
  #stateHandlers: Array<(state: ConnectionState) => void> = [];
  #errorHandlers: Array<(error: Error) => void> = [];
  #userClosed = false;

  constructor(
    readonly id: string,
    protected readonly options: NetworkOptions
  ) {
    this.type = options.protocol; // 'tcp' albo 'tls'
  }

  get state(): ConnectionState {
    return this.#state;
  }

  async connect(): Promise<void> {
    if (this.#socket) return;
    this.#setState('connecting');

    const secure = this.options.protocol === 'tls';
    const timeout = this.options.connectTimeoutMs ?? 15_000;

    // Promise rozwiązuje się gotowym gniazdem — pole ustawiamy z wyniku await, nie odczytując
    // go z powrotem (przypisanie w callbacku nie wraca do analizy przepływu TypeScriptu).
    const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
      // TLS: domyślnie weryfikujemy certyfikat; `insecureTls` świadomie to wyłącza
      // (np. self-signed w laboratorium). Bez tej flagi błędny certyfikat zrywa handshake.
      const s = secure
        ? tlsConnect({
            host: this.options.host,
            port: this.options.port,
            rejectUnauthorized: !this.options.insecureTls
          })
        : netConnect({ host: this.options.host, port: this.options.port });

      const readyEvent = secure ? 'secureConnect' : 'connect';

      // Zegar łączenia: gniazdo zawieszone na nieistniejącym hoście inaczej wisiałoby długo.
      if (timeout > 0) s.setTimeout(timeout);

      s.once(readyEvent, () => {
        s.setTimeout(0);
        resolve(s);
      });
      s.once('timeout', () => {
        s.destroy();
        reject(new Error(`Przekroczono czas łączenia (${timeout} ms)`));
      });
      s.once('error', (error) => {
        s.destroy();
        reject(error);
      });
    }).catch((error: unknown) => {
      this.#setState('error');
      this.#emitError(error);
      throw error;
    });

    this.#socket = socket;
    this.#attach(socket);
    this.#emitData(
      okNotice(`Połączono ${this.options.protocol.toUpperCase()} ${this.options.host}:${this.options.port}`)
    );
    this.#setState('connected');
  }

  /** Podpina obsługę strumienia; wydzielone, by Telnet mógł nadpisać przetwarzanie danych. */
  protected onChunk(chunk: Buffer): void {
    this.#emitData(chunk);
  }

  #attach(socket: Socket | TLSSocket): void {
    socket.on('data', (chunk: Buffer) => this.onChunk(chunk));
    socket.once('close', () => {
      this.#socket = undefined;
      if (this.#userClosed) return;
      this.#emitData(notice('Połączenie zamknięte przez drugą stronę.'));
      this.#setState('closed');
    });
    // Błąd po zestawieniu sesji (np. reset) nie może wywrócić procesu.
    socket.on('error', (error) => this.#emitError(error));
  }

  async disconnect(): Promise<void> {
    this.#userClosed = true;
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.end();
    socket?.destroy();
    if (this.#state !== 'closed') this.#setState('closed');
  }

  async write(data: string | Uint8Array): Promise<void> {
    const socket = this.#socket;
    if (!socket) return;
    socket.write(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data));
  }

  // `resize` celowo nieobsługiwane — połączenie sieciowe nie ma pojęcia rozmiaru okna.

  onData(callback: (data: Uint8Array) => void): void {
    this.#dataHandlers.push(callback);
  }

  onStateChange(callback: (state: ConnectionState) => void): void {
    this.#stateHandlers.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.#errorHandlers.push(callback);
  }

  /** Dostęp do gniazda dla podklas (Telnet wysyła odpowiedzi negocjacji IAC). */
  protected get socket(): Socket | TLSSocket | undefined {
    return this.#socket;
  }

  /** Emisja bajtów do terminala — także dla podklas (np. odfiltrowany strumień Telnetu). */
  protected emit(chunk: Uint8Array): void {
    this.#emitData(chunk);
  }

  #emitData(chunk: Uint8Array): void {
    for (const handler of this.#dataHandlers) handler(chunk);
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
