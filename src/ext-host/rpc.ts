/**
 * Klient RPC po stronie procesu wtyczki (Plugin API v2, etap 2).
 *
 * Jedyna droga wtyczki do aplikacji. Każde wywołanie ma identyfikator, odpowiedź i limit
 * czasu — inaczej niż w v1, gdzie komendy i powiadomienia szły „w ciemno", a brak
 * uprawnienia był cichym niczym.
 *
 * Ruch idzie w obie strony: wtyczka pyta aplikację (`wywolaj`), aplikacja woła wtyczkę
 * (np. uruchomienie komendy z palety) i wysyła jej zdarzenia (zmiana aktywnej zakładki).
 */

import { RPC_TIMEOUT_MS, type RpcMessage, type RpcRequest } from '@core/plugins/protocol';

const port = process.parentPort;

let licznik = 0;
const oczekujace = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

/** Handlery żądań OD aplikacji (np. „uruchom komendę"). */
const handlery = new Map<string, (params: unknown) => unknown | Promise<unknown>>();

/** Nasłuchy zdarzeń aplikacji. Jedno zdarzenie może mieć wielu odbiorców. */
const nasluchy = new Map<string, Array<(payload: unknown) => void>>();

/** Błąd RPC niosący kod z protokołu — wtyczka może odróżnić brak uprawnienia od braku sesji. */
export class BladRpc extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'BladRpc';
  }
}

/** Wywołuje metodę aplikacji i czeka na odpowiedź. */
export function wywolaj(method: string, params?: unknown): Promise<unknown> {
  const id = `c${++licznik}`;
  const request: RpcRequest = { kind: 'req', id, method, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      oczekujace.delete(id);
      reject(new BladRpc('ETIMEDOUT', `Brak odpowiedzi aplikacji na ${method}`));
    }, RPC_TIMEOUT_MS);
    oczekujace.set(id, { resolve, reject, timer });
    port.postMessage(request);
  });
}

/** Rejestruje obsługę żądania OD aplikacji. */
export function naZadanie(method: string, handler: (params: unknown) => unknown | Promise<unknown>): void {
  handlery.set(method, handler);
}

/** Rejestruje nasłuch zdarzenia aplikacji; zwraca funkcję wypisującą. */
export function naZdarzenie(event: string, callback: (payload: unknown) => void): () => void {
  const lista = nasluchy.get(event) ?? [];
  lista.push(callback);
  nasluchy.set(event, lista);
  return () => {
    const biezaca = nasluchy.get(event);
    if (!biezaca) return;
    const i = biezaca.indexOf(callback);
    if (i !== -1) biezaca.splice(i, 1);
  };
}

/** Wpina wiadomość z aplikacji w odpowiednie miejsce. Zwraca `true`, gdy ją obsłużono. */
export function obsluzWiadomosc(message: RpcMessage): boolean {
  if (message.kind === 'res') {
    const czeka = oczekujace.get(message.id);
    if (!czeka) return true;
    clearTimeout(czeka.timer);
    oczekujace.delete(message.id);
    czeka.resolve(message.result);
    return true;
  }

  if (message.kind === 'err') {
    const czeka = oczekujace.get(message.id);
    if (!czeka) return true;
    clearTimeout(czeka.timer);
    oczekujace.delete(message.id);
    czeka.reject(new BladRpc(message.code, message.message));
    return true;
  }

  if (message.kind === 'evt') {
    // Wyjątek w kodzie wtyczki nie może wywrócić pętli zdarzeń hosta.
    for (const cb of nasluchy.get(message.event) ?? []) {
      try {
        cb(message.payload);
      } catch (error) {
        console.error(`[wtyczka] błąd w nasłuchu ${message.event}:`, error);
      }
    }
    return true;
  }

  if (message.kind === 'req') {
    const handler = handlery.get(message.method);
    if (!handler) {
      port.postMessage({ kind: 'err', id: message.id, code: 'ENOTSUP', message: `nieznana metoda ${message.method}` });
      return true;
    }
    Promise.resolve()
      .then(() => handler(message.params))
      .then((result) => port.postMessage({ kind: 'res', id: message.id, result }))
      .catch((error: unknown) =>
        port.postMessage({
          kind: 'err',
          id: message.id,
          code: 'EFAIL',
          message: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  return false;
}
