/**
 * Implementacja `TerminalTransport` dla WebSocketu (Etap 7).
 *
 * Korzysta z globalnego `WebSocket` (undici) obecnego w Node 24 pod Electronem — bez
 * dodatkowej zależności. Ramki tekstowe i binarne trafiają do terminala jako bajty; wejście
 * z klawiatury idzie ramką tekstową, dane binarne (np. wysyłka hex) ramką binarną.
 */

import type {
  ConnectionState,
  NetworkOptions,
  TerminalTransport
} from '@core/transports/transport';
import { notice, okNotice } from './notice.ts';

export class WebSocketTransport implements TerminalTransport {
  readonly type = 'ws';

  #ws: WebSocket | undefined;
  #state: ConnectionState = 'idle';
  #dataHandlers: Array<(data: Uint8Array) => void> = [];
  #stateHandlers: Array<(state: ConnectionState) => void> = [];
  #errorHandlers: Array<(error: Error) => void> = [];
  #userClosed = false;

  constructor(
    readonly id: string,
    private readonly options: NetworkOptions
  ) {}

  get state(): ConnectionState {
    return this.#state;
  }

  /** Składa URL z pól opcji: wss dla szyfrowanego, ścieżka opcjonalna. */
  #url(): string {
    const scheme = this.options.protocol === 'wss' ? 'wss' : 'ws';
    const path = this.options.path ?? '/';
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${scheme}://${this.options.host}:${this.options.port}${suffix}`;
  }

  async connect(): Promise<void> {
    if (this.#ws) return;
    this.#setState('connecting');

    // Promise rozwiązuje się otwartym gniazdem — pole ustawiamy z wyniku await, nie
    // odczytując go z powrotem (przypisanie w callbacku nie wraca do analizy przepływu TS).
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.#url());
      // arraybuffer zamiast Blob: chcemy synchronicznie dostać bajty w onmessage.
      socket.binaryType = 'arraybuffer';

      socket.addEventListener('open', () => resolve(socket), { once: true });
      // Błąd przed 'open' to nieudane połączenie; Event nie niesie szczegółu, więc opisujemy sami.
      socket.addEventListener(
        'error',
        () => reject(new Error(`Nie udało się połączyć z ${this.#url()}`)),
        { once: true }
      );
    }).catch((error: unknown) => {
      this.#setState('error');
      this.#emitError(error);
      throw error;
    });

    this.#ws = ws;

    ws.addEventListener('message', (event: MessageEvent) => {
      const { data } = event;
      if (typeof data === 'string') this.#emitData(Buffer.from(data, 'utf8'));
      else if (data instanceof ArrayBuffer) this.#emitData(new Uint8Array(data));
    });
    ws.addEventListener('close', () => {
      this.#ws = undefined;
      if (this.#userClosed) return;
      this.#emitData(notice('Połączenie WebSocket zamknięte.'));
      this.#setState('closed');
    });
    ws.addEventListener('error', () =>
      this.#emitError(new Error('Błąd połączenia WebSocket'))
    );

    this.#emitData(okNotice(`Połączono ${this.#url()}`));
    this.#setState('connected');
  }

  async disconnect(): Promise<void> {
    this.#userClosed = true;
    this.#ws?.close();
    this.#ws = undefined;
    if (this.#state !== 'closed') this.#setState('closed');
  }

  async write(data: string | Uint8Array): Promise<void> {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Tekst z klawiatury → ramka tekstowa; bajty → ramka binarna.
    if (typeof data === 'string') ws.send(data);
    else ws.send(Buffer.from(data));
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
