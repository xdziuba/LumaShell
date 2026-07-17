/**
 * Kontrakt transportu terminala.
 *
 * Ten plik należy do `core` — definiuje wyłącznie kontrakty i nie może importować
 * zależności natywnych ani API Node.js. Implementacje żyją w `services`
 * (docs/architecture/06-struktura-projektu.md).
 */

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

/**
 * Transport oddaje **bajty**, nie tekst.
 *
 * Port szeregowy bywa z natury binarny (widok hex, protokoły ramkowe), więc dekodowanie
 * na poziomie transportu zamykałoby drogę do Etapu 4. Dekodowanie należy do warstwy
 * prezentacji — xterm przyjmuje `Uint8Array` i sam składa sekwencje UTF-8 rozjechane
 * między porcjami.
 */
export interface TerminalTransport {
  readonly id: string;
  readonly type: string;
  readonly state: ConnectionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: string | Uint8Array): Promise<void>;
  resize?(columns: number, rows: number): Promise<void>;

  onData(callback: (data: Uint8Array) => void): void;
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

/** Opcje otwarcia portu szeregowego. Nazwy zgodne z terminologią z dokumentacji. */
export interface SerialOptions {
  path: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  /** Sprzętowa kontrola przepływu RTS/CTS. */
  rtscts?: boolean;
}

/**
 * Opcje połączenia SSH.
 *
 * Dane uwierzytelniające przychodzą tu z magazynu poświadczeń i nigdy nie są
 * zapisywane w konfiguracji (docs/security/02-sekrety.md).
 */
export interface SshOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Ścieżka do gniazda/pipe agenta SSH (np. pipe OpenSSH na Windows). */
  agent?: string;
  columns?: number;
  rows?: number;
  /** Odstęp keep-alive w ms; 0 wyłącza. */
  keepAliveInterval?: number;
  /**
   * Weryfikacja klucza hosta. Dostaje surowy klucz publiczny; zwraca `true`, gdy połączyć.
   *
   * Transport jest tylko mechanizmem — polityka (known_hosts, pytanie użytkownika) należy
   * do wołającego (docs/security). Gdy brak, klucz jest akceptowany bez weryfikacji, więc
   * proces główny zawsze go dostarcza; pomijają go jedynie kontrolowane testy.
   */
  verifyHost?: (hostKey: Uint8Array) => Promise<boolean>;
}

/** Port szeregowy wykryty w systemie. */
export interface SerialPortInfo {
  path: string;
  friendlyName?: string;
  manufacturer?: string;
}
