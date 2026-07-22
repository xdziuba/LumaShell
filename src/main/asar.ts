/**
 * Ścieżki wychodzące poza archiwum asar.
 *
 * Electron potrafi czytać pliki z `app.asar` tak, jakby były katalogiem — ale tylko przez
 * własną nakładkę na `fs`. Są rzeczy, które tej nakładki nie widzą, bo dzieją się poza
 * procesem: uruchomienie procesu potomnego (`utilityProcess.fork`) potrzebuje PRAWDZIWEGO
 * pliku na dysku. Bez tego proces w wersji spakowanej nie wstaje, nie ma PID-u i nie zgłasza
 * błędu — po prostu nic się nie dzieje.
 *
 * Rozwiązanie: pliki, które muszą istnieć fizycznie, są w `asarUnpack` (electron-builder.yml),
 * a tutaj mapujemy ich ścieżkę z `app.asar` na `app.asar.unpacked`.
 */

import { existsSync } from 'node:fs';

const ASAR = 'app.asar';
const ROZPAKOWANY = 'app.asar.unpacked';

/**
 * Zamienia ścieżkę wewnątrz archiwum na jej rozpakowany odpowiednik, jeśli taki istnieje.
 *
 * W trybie deweloperskim (brak asara) i dla plików spoza archiwum zwraca wejście bez zmian,
 * więc można ją stosować bezwarunkowo.
 */
export function pozaAsarem(sciezka: string): string {
  if (!sciezka.includes(ASAR)) return sciezka;
  const rozpakowana = sciezka.replace(ASAR, ROZPAKOWANY);
  return existsSync(rozpakowana) ? rozpakowana : sciezka;
}
