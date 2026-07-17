/**
 * Model komendy dla palety poleceń (Etap 2).
 *
 * Komendy są budowane w App na podstawie bieżącego stanu (powłoki, porty, zakładki),
 * więc paleta i skróty operują na tej samej liście — jedno źródło prawdy.
 */

export interface Command {
  id: string;
  title: string;
  /** Dodatkowe słowa do wyszukiwania (np. „terminal", „nowa"). */
  keywords?: string;
  /** Etykieta skrótu do pokazania po prawej, np. „Ctrl+T". */
  hint?: string;
  run: () => void;
}
