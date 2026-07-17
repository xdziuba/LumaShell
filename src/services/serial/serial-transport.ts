/**
 * Implementacja `TerminalTransport` dla portu szeregowego (COM/UART).
 *
 * Ten plik należy do `services` — tu wolno sięgać do zależności natywnych.
 */

import { SerialPort } from 'serialport';
import type {
  ConnectionState,
  SerialOptions,
  SerialPortInfo,
  TerminalTransport
} from '@core/transports/transport';

/**
 * Zamienia surowy błąd otwarcia portu na czytelny komunikat po polsku.
 *
 * Najczęstszy przypadek na Windows to „Access denied" — port jest wyłączny, więc trzyma go
 * inna aplikacja (PuTTY, inna konsola, monitor UART). Bez tej podpowiedzi użytkownik widzi
 * tylko techniczny komunikat i nie wie, że wystarczy zamknąć drugie połączenie.
 */
function friendlySerialError(error: Error, path: string): Error {
  const message = error.message.toLowerCase();
  if (message.includes('access denied') || message.includes('eacces') || message.includes('ebusy')) {
    return new Error(
      `Port ${path} jest zajęty lub niedostępny — najpewniej trzyma go inna aplikacja ` +
        `(np. PuTTY albo inny monitor portu). Zamknij tamto połączenie i spróbuj ponownie.`
    );
  }
  if (message.includes('file not found') || message.includes('enoent') || message.includes('cannot find')) {
    return new Error(`Nie znaleziono portu ${path} — sprawdź, czy urządzenie jest podłączone.`);
  }
  return new Error(`Nie udało się otworzyć portu ${path}: ${error.message}`);
}

/** Lista portów widocznych w systemie. Operacja tylko do odczytu, bez otwierania. */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((port) => ({
    path: port.path,
    friendlyName: (port as { friendlyName?: string }).friendlyName,
    manufacturer: port.manufacturer
  }));
}

export class SerialTransport implements TerminalTransport {
  readonly type = 'serial';

  #port: SerialPort | undefined;
  #state: ConnectionState = 'idle';
  #dataHandlers: Array<(data: Uint8Array) => void> = [];
  #stateHandlers: Array<(state: ConnectionState) => void> = [];
  #errorHandlers: Array<(error: Error) => void> = [];

  constructor(
    readonly id: string,
    private readonly options: SerialOptions
  ) {}

  get state(): ConnectionState {
    return this.#state;
  }

  async connect(): Promise<void> {
    if (this.#port?.isOpen) return;
    this.#setState('connecting');

    await new Promise<void>((resolve, reject) => {
      const port = new SerialPort(
        {
          path: this.options.path,
          baudRate: this.options.baudRate,
          dataBits: this.options.dataBits ?? 8,
          stopBits: this.options.stopBits ?? 1,
          parity: this.options.parity ?? 'none',
          rtscts: this.options.rtscts ?? false,
          autoOpen: false
        },
        // Konstruktor przyjmuje callback błędu otwarcia tylko przy autoOpen.
        undefined
      );

      port.open((error) => {
        if (error) {
          this.#setState('error');
          // Czytelny komunikat zamiast surowego „Access denied" — patrz friendlySerialError.
          reject(friendlySerialError(error, this.options.path));
          return;
        }
        this.#port = port;
        resolve();
      });
    }).catch((error: unknown) => {
      this.#emitError(error);
      throw error;
    });

    const port = this.#port;
    if (!port) return;

    // Port oddaje Buffery — zgodnie z kontraktem idą dalej bez dekodowania.
    port.on('data', (chunk: Buffer) => {
      for (const handler of this.#dataHandlers) handler(chunk);
    });

    // Wyciągnięcie kabla USB to zamknięcie sesji, nie awaria aplikacji.
    port.on('close', () => {
      this.#port = undefined;
      this.#setState('closed');
    });

    port.on('error', (error) => {
      this.#emitError(error);
      this.#setState('error');
    });

    this.#setState('connected');
  }

  async disconnect(): Promise<void> {
    const port = this.#port;
    if (!port) return;
    this.#port = undefined;
    await new Promise<void>((resolve) => {
      if (!port.isOpen) return resolve();
      port.close(() => resolve());
    });
    this.#setState('closed');
  }

  async write(data: string | Uint8Array): Promise<void> {
    const port = this.#port;
    if (!port?.isOpen) return;
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    await new Promise<void>((resolve, reject) => {
      port.write(payload, (error) => (error ? reject(error) : resolve()));
    });
  }

  // `resize` celowo nie jest zaimplementowane — port szeregowy nie ma pojęcia
  // rozmiaru okna. Metoda jest w kontrakcie opcjonalna właśnie z tego powodu.

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
