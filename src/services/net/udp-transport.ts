/**
 * Implementacja `TerminalTransport` dla UDP (Etap 7).
 *
 * UDP jest bezpołączeniowy, więc „sesja" to lokalne gniazdo skojarzone (connect) ze zdalnym
 * peerem: datagramy od niego trafiają do terminala, a wejście leci do niego datagramem.
 * Skojarzenie filtruje ruch — nie przyjmujemy pakietów od obcych nadawców. Payload idzie do
 * xterm surowo (kontrakt bajtowy); brak strumienia oznacza brak gwarancji kolejności.
 */

import { createSocket, type Socket } from 'node:dgram';
import { isIPv6 } from 'node:net';
import type {
  ConnectionState,
  NetworkOptions,
  TerminalTransport
} from '@core/transports/transport';
import { okNotice } from './notice.ts';

export class UdpTransport implements TerminalTransport {
  readonly type = 'udp';

  #socket: Socket | undefined;
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

  async connect(): Promise<void> {
    if (this.#socket) return;
    this.#setState('connecting');

    const socket = createSocket(isIPv6(this.options.host) ? 'udp6' : 'udp4');
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      // connect() automatycznie binduje efemeryczny port lokalny i utrwala zdalny cel.
      socket.connect(this.options.port, this.options.host, () => {
        socket.off('error', reject);
        resolve();
      });
    }).catch((error: unknown) => {
      this.#setState('error');
      this.#emitError(error);
      socket.close();
      this.#socket = undefined;
      throw error;
    });

    socket.on('message', (msg: Buffer) => this.#emitData(msg));
    socket.on('error', (error) => this.#emitError(error));
    socket.on('close', () => {
      this.#socket = undefined;
      if (this.#userClosed) return;
      this.#setState('closed');
    });

    this.#emitData(okNotice(`Gniazdo UDP → ${this.options.host}:${this.options.port}`));
    this.#setState('connected');
  }

  async disconnect(): Promise<void> {
    this.#userClosed = true;
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
    if (this.#state !== 'closed') this.#setState('closed');
  }

  async write(data: string | Uint8Array): Promise<void> {
    const socket = this.#socket;
    if (!socket) return;
    // Gniazdo skojarzone — send bez adresu trafia do utrwalonego peera.
    socket.send(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data));
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
