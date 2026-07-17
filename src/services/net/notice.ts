/**
 * Komunikaty LumaShell wstrzykiwane w strumień terminala sesji sieciowych (Etap 7).
 *
 * Transport sieciowy nie ma własnego kanału statusu jak SSH — informacje o zestawieniu,
 * zamknięciu czy błędzie połączenia trafiają do użytkownika tą samą drogą co dane, jako
 * kolorowana linia. Wzorzec przejęty z SshTransport.
 */

/** Ostrzeżenie/informacja (żółty). */
export const notice = (text: string): Buffer =>
  Buffer.from(`\r\n\x1b[33m[LumaShell] ${text}\x1b[0m\r\n`);

/** Potwierdzenie (zielony). */
export const okNotice = (text: string): Buffer =>
  Buffer.from(`\r\n\x1b[32m[LumaShell] ${text}\x1b[0m\r\n`);
