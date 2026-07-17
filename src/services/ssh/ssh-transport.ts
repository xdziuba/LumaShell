/**
 * Implementacja `TerminalTransport` dla SSH (ssh2).
 *
 * Uwierzytelnianie hasłem, kluczem lub agentem, interaktywna powłoka, keep-alive,
 * weryfikacja klucza hosta, automatyczne wznawianie po zerwaniu (Etap 3). Jump host,
 * forwarding i SFTP wchodzą później (docs/architecture/08-roadmapa.md).
 */

import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import type {
  ConnectionState,
  SshOptions,
  TerminalTransport
} from '@core/transports/transport';

/** Wpis katalogu zdalnego. */
export interface SftpEntry {
  name: string;
  type: 'dir' | 'file' | 'other';
  size: number;
}

/** Kolor komunikatów LumaShell wstrzykiwanych w strumień terminala. */
const NOTICE = (text: string): Buffer => Buffer.from(`\r\n\x1b[33m[LumaShell] ${text}\x1b[0m\r\n`);
const OK_NOTICE = (text: string): Buffer => Buffer.from(`\r\n\x1b[32m[LumaShell] ${text}\x1b[0m\r\n`);

export class SshTransport implements TerminalTransport {
  readonly type = 'ssh';

  #client: Client | undefined;
  #stream: ClientChannel | undefined;
  #sftp: SFTPWrapper | undefined;
  #state: ConnectionState = 'idle';
  #dataHandlers: Array<(data: Uint8Array) => void> = [];
  #stateHandlers: Array<(state: ConnectionState) => void> = [];
  #errorHandlers: Array<(error: Error) => void> = [];
  /** Ustawiane, gdy rozłączenie zainicjował użytkownik — wtedy nie wznawiamy. */
  #userClosed = false;
  #reconnectTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly id: string,
    private readonly options: SshOptions
  ) {}

  get state(): ConnectionState {
    return this.#state;
  }

  async connect(): Promise<void> {
    if (this.#client) return;
    await this.#establish();
  }

  /** Zestawia klient + interaktywną powłokę i podpina obsługę strumienia. */
  async #establish(): Promise<void> {
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
          // Handshake obejmuje weryfikację klucza hosta, a ta czeka na decyzję użytkownika
          // (np. przy groźnym „klucz się zmienił"). Domyślne 20 s ssh2 bywa za krótkie,
          // więc dajemy zapas obejmujący nasz 2-minutowy timeout pytania.
          readyTimeout: 150_000,
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
    this.#stream.on('data', (chunk: Buffer) => this.#emitData(chunk));
    // stderr zdalnej powłoki też należy do obrazu terminala.
    this.#stream.stderr.on('data', (chunk: Buffer) => this.#emitData(chunk));

    this.#stream.once('close', () => {
      // Zamknięcie zainicjowane przez użytkownika obsługuje disconnect(); tu reagujemy
      // tylko na zerwanie z zewnątrz.
      if (this.#userClosed) return;
      void this.#handleDrop();
    });

    client.once('error', (error) => this.#emitError(error));

    this.#setState('connected');
  }

  /** Zerwane połączenie: próbuje wznowić z backoffem albo się poddaje. */
  async #handleDrop(): Promise<void> {
    this.#client = undefined;
    this.#stream = undefined;
    this.#sftp = undefined;

    const attempts = this.options.reconnect?.attempts ?? 5;
    const baseDelay = this.options.reconnect?.delayMs ?? 1000;
    if (attempts <= 0) {
      this.#setState('closed');
      return;
    }

    for (let n = 1; n <= attempts && !this.#userClosed; n += 1) {
      this.#emitData(NOTICE(`Połączenie zerwane — ponawiam (${n}/${attempts})…`));
      // Backoff wykładniczy z sufitem, żeby nie zalewać zdalnego hosta.
      const delay = Math.min(baseDelay * 2 ** (n - 1), 15_000);
      await new Promise<void>((resolve) => {
        this.#reconnectTimer = setTimeout(resolve, delay);
      });
      if (this.#userClosed) return;

      try {
        await this.#establish();
        // `#establish` ustawia już stan 'connected' i ustawia nowy stream.
        this.#emitData(OK_NOTICE('Połączono ponownie.'));
        return;
      } catch {
        // Kolejna próba w następnej iteracji.
      }
    }

    if (!this.#userClosed) {
      this.#emitData(NOTICE('Nie udało się wznowić połączenia.'));
      this.#setState('closed');
    }
  }

  async disconnect(): Promise<void> {
    this.#userClosed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#stream?.end();
    this.#stream = undefined;
    this.#sftp = undefined;
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

  // --- SFTP: podsystem plików na tym samym połączeniu SSH ---

  /** Otwiera (leniwie) i cache'uje jedną sesję SFTP na tym połączeniu. */
  async #ensureSftp(): Promise<SFTPWrapper> {
    if (this.#sftp) return this.#sftp;
    const client = this.#client;
    if (!client) throw new Error('Sesja SSH nie jest połączona');
    this.#sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)));
    });
    // Po zerwaniu klienta cache SFTP jest nieważny.
    this.#sftp.once('close', () => {
      this.#sftp = undefined;
    });
    return this.#sftp;
  }

  /** Rozwija ścieżkę (np. '.' albo '~') do bezwzględnej — punkt startowy przeglądarki. */
  async sftpRealpath(path: string): Promise<string> {
    const sftp = await this.#ensureSftp();
    return new Promise<string>((resolve, reject) => {
      sftp.realpath(path, (error, abs) => (error ? reject(error) : resolve(abs)));
    });
  }

  async sftpList(path: string): Promise<SftpEntry[]> {
    const sftp = await this.#ensureSftp();
    return new Promise<SftpEntry[]>((resolve, reject) => {
      sftp.readdir(path, (error, list) => {
        if (error) return reject(error);
        resolve(
          list.map((entry) => ({
            name: entry.filename,
            type: entry.attrs.isDirectory() ? 'dir' : entry.attrs.isFile() ? 'file' : 'other',
            size: entry.attrs.size
          }))
        );
      });
    });
  }

  async sftpRead(path: string): Promise<Buffer> {
    const sftp = await this.#ensureSftp();
    return new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
    });
  }

  async sftpWrite(path: string, data: Buffer): Promise<void> {
    const sftp = await this.#ensureSftp();
    return new Promise<void>((resolve, reject) => {
      sftp.writeFile(path, data, (error) => (error ? reject(error) : resolve()));
    });
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
