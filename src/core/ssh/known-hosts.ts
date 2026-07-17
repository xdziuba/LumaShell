/**
 * Weryfikacja klucza hosta SSH (Etap 3).
 *
 * Czysta logika w `core` — bez IPC i bez node:crypto w samej decyzji, więc testowalna
 * jednostkowo (docs/architecture/06-struktura-projektu.md). Liczenie odcisku (wymaga
 * crypto) jest wstrzykiwane, żeby ten moduł pozostał czysty.
 */

/** Wynik porównania prezentowanego klucza z zapamiętanym. */
export type HostTrust =
  | 'trusted' // odcisk zgadza się z zapamiętanym
  | 'unknown' // hosta nie ma w magazynie (pierwsze połączenie, TOFU)
  | 'changed'; // odcisk RÓŻNY od zapamiętanego — możliwy atak MITM

/** Klucz magazynu: host i port jednoznacznie identyfikują serwer. */
export function hostKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * Decyzja zaufania na podstawie zapamiętanego i prezentowanego odcisku.
 *
 * Sama porównuje ciągi — nie podejmuje polityki (co zrobić z 'unknown'/'changed').
 * To należy do wołającego: 'unknown' zwykle pyta użytkownika (TOFU), 'changed' powinno
 * domyślnie odrzucać.
 */
export function evaluateHost(stored: string | undefined, presented: string): HostTrust {
  if (stored === undefined) return 'unknown';
  return stored === presented ? 'trusted' : 'changed';
}
