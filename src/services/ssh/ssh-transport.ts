/**
 * Implementacja `TerminalTransport` dla SSH (ssh2).
 *
 * Uwierzytelnianie hasłem, kluczem lub agentem, interaktywna powłoka, keep-alive,
 * weryfikacja klucza hosta (Etap 3). Jump host, forwarding i SFTP wchodzą później
 * (docs/architecture/08-roadmapa.md).
 */

import { Client, type ClientChannel } from 'ssh2';
import type {
  ConnectionState,
  SshOptions,
  TerminalTransport
} from '@core/transports/transport';

export class SshTransport implements TerminalTransport {
  readonly type = 'ssh';

  #client: Client | undefined;
  #stream: ClientChannel | undefined;
  #state: ConnectionState = 'idle';
  #dataHandlers: Array<(data: Uint8Array) => void> = [];
  #stateHandlers: Array<(state: ConnectionState) => void> = [];
  #errorHandlers: Array<(error: Error) => void> = [];

  constructor(
    readonly id: string,
    private readonly options: SshOptions
  ) {}

  get state(): ConnectionState {
    return this.#state;
  }

  async connect(): Promise<void> {
    if (this.#client) return;
    this.#setState('connecting');

    const client = new Client();
    this.#client = client;

    try {
      await new Promise<void>((resolve, reject) => {
        client.once('ready', resolve);
        client.once('error', reject);

        client.connect({
          host: this.options.host,
          port: this.options.port ?? 22,
          username: this.options.username,
          password: this.options.password,
          privateKey: this.options.privateKey,
          passphrase: this.options.passphrase,
          agent: this.options.agent,
          // Keep-alive utrzymuje sesję przy życiu za NAT-em i na kapryśnych łączach.
          keepaliveInterval: this.options.keepAliveInterval ?? 15_000,
          // Weryfikacja klucza hosta. Odrzucenie tutaj zrywa handshake, zanim polecą
          // jakiekolwiek dane uwierzytelniające — chroni przed MITM.
          hostVerifier: (key: Buffer, accept: (ok: boolean) => void) => {
            const verify = this.options.verifyHost;
            if (!verify) return accept(true);
            verify(key).then(accept).catch(() => accept(false));
          }
        });
      });

      this.#stream = await new Promise<ClientChannel>((resolve, reject) => {
        client.shell(
          { term: 'xterm-256color', cols: this.options.columns ?? 80, rows: this.options.rows ?? 24 },
          (error, stream) => (error ? reject(error) : resolve(stream))
        );
      });
    } catch (error) {
      this.#setState('error');
      this.#emitError(error);
      // Bez tego wiszące gniazdo przeżyłoby nieudaną próbę połączenia.
      client.end();
      this.#client = undefined;
      throw error;
    }

    // Strumień oddaje Buffery — zgodnie z kontraktem idą dalej bez dekodowania.
    this.#stream.on('data', (chunk: Buffer) => {
      for (const handler of this.#dataHandlers) handler(chunk);
    });

    // stderr zdalnej powłoki też należy do obrazu terminala.
    this.#stream.stderr.on('data', (chunk: Buffer) => {
      for (const handler of this.#dataHandlers) handler(chunk);
    });

    this.#stream.once('close', () => {
      void this.disconnect();
    });

    client.once('error', (error) => this.#emitError(error));

    this.#setState('connected');
  }

  async disconnect(): Promise<void> {
    this.#stream?.end();
    this.#stream = undefined;
    this.#client?.end();
    this.#client = undefined;
    if (this.#state !== 'closed') this.#setState('closed');
  }

  async write(data: string | Uint8Array): Promise<void> {
    this.#stream?.write(typeof data === 'string' ? data : Buffer.from(data));
  }

  async resize(columns: number, rows: number): Promise<void> {
    // Wysokość i szerokość w pikselach są nieznane — zero oznacza „bez znaczenia".
    this.#stream?.setWindow(rows, columns, 0, 0);
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

  #setState(state: ConnectionState): void {
    this.#state = state;
    for (const handler of this.#stateHandlers) handler(state);
  }

  #emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    for (const handler of this.#errorHandlers) handler(normalized);
  }
}
