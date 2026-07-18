/**
 * Rejestr aktywnych terminali — most między panelem czatu AI a widokiem xterm.
 *
 * Panel czatu jest osobną zakładką i zastępuje terminal, więc w chwili rozmowy nie ma
 * bezpośredniego dostępu do instancji xterm. Ten rejestr pozwala pobrać zaznaczenie i
 * ostatnie wyjście z ostatnio aktywnej sesji (albo z tej, w której coś zaznaczono), żeby
 * dołączyć je jako kontekst — bez wykonywania żadnych akcji (AI-1).
 */

export interface TerminalAccessor {
  /** Aktualnie zaznaczony tekst (pusty, gdy nic nie zaznaczono). */
  getSelection(): string;
  /** Ostatnie `maxLines` wierszy bufora (z przewijaniem), przycięte z prawej. */
  getRecentText(maxLines: number): string;
}

const accessors = new Map<string, TerminalAccessor>();
let lastActiveId: string | undefined;

/** Rejestruje terminal; zwraca funkcję wyrejestrowującą (do sprzątania przy odmontowaniu). */
export function registerTerminal(sessionId: string, accessor: TerminalAccessor): () => void {
  accessors.set(sessionId, accessor);
  return () => {
    accessors.delete(sessionId);
    if (lastActiveId === sessionId) lastActiveId = undefined;
  };
}

/** Zaznacza sesję jako ostatnio aktywną (wołane, gdy jej zakładka wchodzi na wierzch). */
export function noteActiveSession(sessionId: string): void {
  if (accessors.has(sessionId)) lastActiveId = sessionId;
}

/** Ostatnio aktywny terminal — źródło „ostatniego wyjścia". */
export function activeTerminal(): TerminalAccessor | undefined {
  return lastActiveId ? accessors.get(lastActiveId) : undefined;
}

/** Identyfikator ostatnio aktywnej sesji — cel akcji „wyślij do terminala" (AI-3). */
export function activeSessionId(): string | undefined {
  return lastActiveId && accessors.has(lastActiveId) ? lastActiveId : undefined;
}

/**
 * Terminal, w którym coś jest zaznaczone (dowolny), a jeśli nigdzie — ostatnio aktywny.
 * Dzięki temu „dołącz zaznaczenie" działa niezależnie od tego, który panel był na wierzchu.
 */
export function terminalWithSelection(): TerminalAccessor | undefined {
  for (const accessor of accessors.values()) {
    if (accessor.getSelection().trim().length > 0) return accessor;
  }
  return activeTerminal();
}
