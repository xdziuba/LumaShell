/**
 * Protokół RPC między procesem głównym a procesem wtyczki (Plugin API v2).
 *
 * Czysta logika w `core` — bez IPC, bez Node, bez DOM. Ten sam plik czytają obie strony,
 * więc kształt wiadomości jest jednym źródłem prawdy.
 *
 * Dwie rzeczy odróżniają to od protokołu v1 (docs/plugin-api/02-uprawnienia-i-izolacja.md):
 *
 * 1. **Żądanie ma odpowiedź.** W v1 tylko narzędzia AI miały korelację `callId`; komendy
 *    i powiadomienia były wysyłane „w ciemno". Wtyczka nie mogła się dowiedzieć, czy
 *    operacja się udała, a brak uprawnienia był cichym niczym. Tu KAŻDE wywołanie ma
 *    identyfikator, odpowiedź i limit czasu — po obu stronach.
 * 2. **Błąd ma kod.** Wtyczka odróżnia „nie masz uprawnienia" od „nie ma takiej sesji"
 *    i może zareagować, zamiast zgadywać z tekstu komunikatu.
 */

/** Kody błędów RPC. Tekst komunikatu jest dla człowieka, kod — dla wtyczki. */
export const RpcError = {
  /** Brak uprawnienia w manifeście albo brak zgody użytkownika. */
  Denied: 'EPERM',
  /** Nieznana metoda — najczęściej wtyczka pisana pod nowszą wersję API. */
  Unknown: 'ENOTSUP',
  /** Nieprawidłowe argumenty (walidacja na granicy). */
  Invalid: 'EINVAL',
  /** Zasób nie istnieje (sesja, zakładka, widok). */
  NotFound: 'ENOENT',
  /** Druga strona nie odpowiedziała w czasie. */
  Timeout: 'ETIMEDOUT',
  /** Wyjątek po stronie wykonawcy. */
  Failed: 'EFAIL'
} as const;

export type RpcErrorCode = (typeof RpcError)[keyof typeof RpcError];

/** Wywołanie metody. Kierunek: wtyczka → host albo host → wtyczka. */
export interface RpcRequest {
  kind: 'req';
  /** Korelacja odpowiedzi; unikalna w obrębie jednego połączenia. */
  id: string;
  method: string;
  params?: unknown;
}

export interface RpcOk {
  kind: 'res';
  id: string;
  result?: unknown;
}

export interface RpcFail {
  kind: 'err';
  id: string;
  code: RpcErrorCode;
  message: string;
}

/** Powiadomienie bez odpowiedzi — zdarzenia (zmiana zakładki, zamknięcie sesji). */
export interface RpcEvent {
  kind: 'evt';
  event: string;
  payload?: unknown;
}

export type RpcMessage = RpcRequest | RpcOk | RpcFail | RpcEvent;

/** Wiadomości sterujące cyklem życia wtyczki: host → proces wtyczki. */
export interface HostControl {
  kind: 'ctl';
  action: 'load' | 'unload';
  /** Bezwzględna ścieżka do modułu wejściowego wtyczki (dla `load`). */
  entry?: string;
  pluginId?: string;
  /** Uprawnienia przyznane wtyczce — proces wtyczki zna je tylko informacyjnie. */
  permissions?: string[];
}

/** Odpowiedzi procesu wtyczki na sterowanie: proces wtyczki → host. */
export interface HostStatus {
  kind: 'sts';
  status: 'ready' | 'loaded' | 'unloaded' | 'error';
  message?: string;
}

export type ChildMessage = RpcMessage | HostStatus;
export type ParentMessage = RpcMessage | HostControl;

/** Limit czasu na odpowiedź RPC. Wtyczka nie może zawiesić aplikacji w nieskończoność. */
export const RPC_TIMEOUT_MS = 30_000;

/** Ile czasu wtyczka dostaje na `deactivate()`, zanim proces zostanie ubity. */
export const DEACTIVATE_TIMEOUT_MS = 2_000;

export function isRpcMessage(value: unknown): value is RpcMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'req' || kind === 'res' || kind === 'err' || kind === 'evt';
}
