/**
 * Trwałe instancje terminala (xterm + sesja) trzymane POZA drzewem Reacta.
 *
 * Powód: podział panelu zmienia kształt drzewa (liść → split), więc React na tej pozycji
 * podmienia typ elementu i kasuje całe poddrzewo. Gdy xterm i sesja należały do komponentu,
 * jego funkcja sprzątająca zabijała PTY — dzielenie okna (a symetrycznie także zamknięcie
 * sąsiada) resetowało trwającą powłokę.
 *
 * Tu instancja żyje pod kluczem PANELU. Montowanie komponentu tylko PRZYPINA jej elementy
 * do DOM, odmontowanie je odpina — sesja działa dalej. Powłoka ginie dopiero wtedy, gdy
 * panel naprawdę zniknie z workspace'u (`disposeTerminalsExcept`) albo zamknie się okno.
 * Przy okazji znika podwójny start sesji w trybie deweloperskim (StrictMode woła efekty
 * dwukrotnie — teraz drugie wywołanie tylko przypina istniejący terminal).
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { HexFormatter, timestamp } from './hex-format';
import { noteActiveSession, registerTerminal } from './terminal-context';
import type { MonitorMode, SessionSpec } from '@shared/types/ipc';
import type { TerminalSettings } from '@shared/types/settings';

export type RendererKind = 'webgl' | 'canvas';

/** Kolory terminala z aktywnego motywu (xterm nie czyta CSS). */
export interface TerminalLook {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
}

/**
 * Zdarzenia oddawane do Reacta. Instancja trzyma je w jednym obiekcie i woła przez
 * pośrednika ze stabilną tożsamością — komponent może się przemontować, a instancja i tak
 * trafi w aktualne callbacki.
 */
export interface TerminalHandlers {
  onReady: (info: { label: string; sessionId: string }) => void;
  onExit: (exitCode: number | undefined) => void;
  onRenderer: (kind: RendererKind) => void;
  onError: (message: string) => void;
}

export interface TerminalInit {
  spec: SessionSpec;
  settings: TerminalSettings;
  look: TerminalLook;
  monitor: MonitorMode | undefined;
  handlers: TerminalHandlers;
}

/**
 * Alfa tła terminala.
 *
 * Tło xterm jest w PEŁNI przezroczyste (0): całe tło niesie jednolita tafla `.term-pane`
 * (glass w SCSS). Dzięki temu padding i obszar tekstu wyglądają identycznie — nie ma
 * „podwójnej ramki" (płótno WebGL malowałoby tint tylko pod tekstem).
 */
const TERM_ALPHA = 0;

/** Nakłada alfę na kolor motywu (hex lub rgb/rgba). Zwraca rgba; nierozpoznany kolor bez zmian. */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1]!.split(',').map((x) => x.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return c;
}

/** Czy zestaw kolorów jest ten sam co do wartości (identyczność obiektu nic tu nie mówi). */
function sameLook(a: TerminalLook, b: TerminalLook): boolean {
  return (
    a.background === b.background &&
    a.foreground === b.foreground &&
    a.cursor === b.cursor &&
    a.selection === b.selection
  );
}

/** Ostatnie zdarzenie sesji — odtwarzane przy ponownym przypięciu do świeżego komponentu. */
type LastEvent =
  | { kind: 'ready'; info: { label: string; sessionId: string } }
  | { kind: 'exit'; code: number | undefined }
  | { kind: 'error'; message: string };

export class TerminalInstance {
  readonly paneId: string;
  /** Odcisk specyfikacji — jej zmiana oznacza inną sesję, więc instancję trzeba wymienić. */
  readonly specKey: string;

  /** Kontener xterm — ten sam element przez całe życie panelu, wędruje między rodzicami. */
  readonly host = document.createElement('div');
  private readonly scrollbar = document.createElement('div');
  private readonly thumb = document.createElement('div');

  private readonly term: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly cleanups: Array<() => void> = [];

  private spec: SessionSpec;
  private settings: TerminalSettings;
  private look: TerminalLook;
  private monitor: MonitorMode | undefined;
  private handlers: TerminalHandlers;

  private hex: HexFormatter | null = null;
  private sessionId: string | undefined;
  private last: LastEvent | null = null;
  private opened = false;
  private disposed = false;

  constructor(paneId: string, specKey: string, init: TerminalInit) {
    this.paneId = paneId;
    this.specKey = specKey;
    this.spec = init.spec;
    this.settings = init.settings;
    this.look = init.look;
    this.monitor = init.monitor;
    this.handlers = init.handlers;

    this.host.className = 'term-host';
    this.scrollbar.className = 'term-scrollbar';
    this.thumb.className = 'term-scrollbar__thumb';
    this.scrollbar.append(this.thumb);

    this.term = new Terminal({
      fontFamily: `${this.settings.fontFamily}, Consolas, monospace`,
      fontSize: this.settings.fontSize,
      lineHeight: this.settings.lineHeight,
      letterSpacing: this.settings.letterSpacing,
      cursorBlink: this.settings.cursorBlink,
      scrollback: this.settings.scrollback,
      allowProposedApi: true,
      // Terminal jako powierzchnia glass: tło półprzezroczyste, tapeta prześwituje.
      allowTransparency: true,
      theme: {
        background: withAlpha(this.look.background, TERM_ALPHA),
        foreground: this.look.foreground,
        cursor: this.look.cursor,
        selectionBackground: this.look.selection
      }
    });

    // Obserwator założony raz, na własnym elemencie — przeżywa przenosiny między rodzicami.
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(this.host);
    this.cleanups.push(() => observer.disconnect());
  }

  /**
   * Przypina elementy terminala do panelu. Pierwsze przypięcie otwiera xterm i zestawia
   * sesję (xterm musi być w DOM, żeby zmierzyć znak); kolejne tylko wracają na miejsce.
   */
  attach(parent: HTMLElement): void {
    if (this.disposed) return;
    parent.append(this.host, this.scrollbar);

    if (!this.opened) {
      this.opened = true;
      this.openTerminal();
      this.startSession();
    } else {
      // Element wrócił do DOM — płótno WebGL trzeba przerysować, inaczej zostaje puste.
      this.term.refresh(0, this.term.rows - 1);
      // Świeży komponent nie zna historii sesji, więc odtwarzamy ostatni stan (etykieta,
      // zakończenie, błąd) — bez tego panel po podziale wisiałby w „uruchamianie".
      this.replayLast();
    }
    this.fit();
  }

  /** Odpina elementy z DOM. Sesja i bufor zostają nietknięte. */
  detach(): void {
    this.host.remove();
    this.scrollbar.remove();
  }

  /** Aktualizacja z Reacta: ustawienia, motyw, tryb monitora i świeże callbacki. */
  update(next: {
    settings: TerminalSettings;
    look: TerminalLook;
    monitor: MonitorMode | undefined;
    handlers: TerminalHandlers;
  }): void {
    this.handlers = next.handlers;

    if (next.settings !== this.settings) {
      this.settings = next.settings;
      const o = this.term.options;
      o.fontFamily = `${this.settings.fontFamily}, Consolas, monospace`;
      o.fontSize = this.settings.fontSize;
      o.lineHeight = this.settings.lineHeight;
      o.letterSpacing = this.settings.letterSpacing;
      o.cursorBlink = this.settings.cursorBlink;
      o.scrollback = this.settings.scrollback;
      // Zmiana rozmiaru czcionki zmienia liczbę kolumn i wierszy — PTY musi to wiedzieć.
      this.fit();
    }

    // Porównanie po WARTOŚCI: App składa obiekt kolorów przy każdym renderze, a podmiana
    // motywu xterm czyści atlas tekstur — po tożsamości przerysowywalibyśmy terminal bez
    // powodu przy każdej zmianie stanu aplikacji.
    if (!sameLook(next.look, this.look)) {
      this.look = next.look;
      this.term.options.theme = {
        background: withAlpha(this.look.background, TERM_ALPHA),
        foreground: this.look.foreground,
        cursor: this.look.cursor,
        selectionBackground: this.look.selection
      };
    }

    // Przełączenie trybu monitora: domknij niepełną linię hex, żeby dane sprzed i po
    // zmianie się nie zlewały.
    const prev = this.monitor;
    this.monitor = next.monitor;
    if (prev?.hex && !next.monitor?.hex && this.hex) {
      this.term.write(this.hex.flush());
      this.hex = null;
    }
    if (next.monitor?.hex) this.hex ??= new HexFormatter();
  }

  /** Zakładka wróciła na wierzch: przelicz wymiary i zgłoś sesję jako ostatnio aktywną. */
  activate(): void {
    this.fit();
    if (this.sessionId) noteActiveSession(this.sessionId);
  }

  /**
   * Dopasowanie terminala do kontenera i przekazanie nowego rozmiaru do sesji.
   *
   * Ukryta zakładka ma zerowe wymiary. `fit()` policzyłby z nich bezsensowną liczbę kolumn
   * i wierszy, a potem wysłał ją do PTY — powłoka zobaczyłaby okno 1×1.
   */
  fit(): void {
    if (this.disposed || !this.opened) return;
    if (this.host.clientWidth === 0 || this.host.clientHeight === 0) return;
    this.fitAddon.fit();
    if (this.sessionId) void window.luma.terminal.resize(this.sessionId, this.term.cols, this.term.rows);
    this.syncScrollbar();
  }

  /** Zamyka sesję i zwalnia xterm. Wołane tylko, gdy panel znika z workspace'u. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    if (this.sessionId) void window.luma.terminal.dispose(this.sessionId);
    this.sessionId = undefined;
    this.detach();
    this.term.dispose();
  }

  // — wnętrze ————————————————————————————————————————————————————————————————

  private replayLast(): void {
    const last = this.last;
    if (!last) return;
    if (last.kind === 'ready') this.handlers.onReady(last.info);
    else if (last.kind === 'exit') this.handlers.onExit(last.code);
    else this.handlers.onError(last.message);
  }

  private openTerminal(): void {
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.host);

    // WebGL bywa niedostępny (sterowniki, zdalny pulpit). Terminal ma wtedy nadal działać
    // na rendererze canvas. Cichy fallback wygląda identycznie, więc wynik raportujemy.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        console.warn('[terminal] utracono kontekst WebGL — przejście na renderer zapasowy');
        webgl.dispose();
        this.handlers.onRenderer('canvas');
      });
      this.term.loadAddon(webgl);
      this.handlers.onRenderer('webgl');
    } catch (error) {
      console.warn('[terminal] WebGL niedostępny, renderer zapasowy:', error);
      this.handlers.onRenderer('canvas');
    }

    this.wireClipboard();
    this.wireScrollbar();
  }

  private wireClipboard(): void {
    const term = this.term;
    const wklej = async (): Promise<void> => {
      const tekst = await navigator.clipboard.readText();
      if (this.sessionId && tekst) await window.luma.terminal.write(this.sessionId, tekst);
    };

    // Ctrl+C w terminalu musi zostać przerwaniem procesu, a nie kopiowaniem — dlatego
    // kopiuje dopiero Ctrl+Shift+C. Wyjątek: gdy coś jest zaznaczone, samo Ctrl+C kopiuje,
    // bo tego oczekuje każdy użytkownik Windows.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey) return true;

      if (event.shiftKey && event.code === 'KeyC') {
        const zaznaczenie = term.getSelection();
        if (zaznaczenie) void navigator.clipboard.writeText(zaznaczenie);
        return false;
      }
      if (event.shiftKey && event.code === 'KeyV') {
        void wklej();
        return false;
      }
      if (!event.shiftKey && event.code === 'KeyC' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      return true;
    });

    // Prawy przycisk: kopiuje zaznaczenie albo wkleja — zachowanie znane z konsoli Windows.
    const menuKontekstowe = (event: MouseEvent): void => {
      event.preventDefault();
      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
      } else {
        void wklej();
      }
    };
    this.host.addEventListener('contextmenu', menuKontekstowe);
    this.cleanups.push(() => this.host.removeEventListener('contextmenu', menuKontekstowe));
  }

  /**
   * Własny scrollbar: xterm z WebGL nie przepełnia viewportu, więc rysujemy nakładkę
   * synchronizowaną z buforem (pojawia się przy overflow, przeciągalna; kółko działa dalej).
   */
  private wireScrollbar(): void {
    const term = this.term;
    let syncPending = false;
    const scheduleSync = (): void => {
      if (syncPending) return;
      syncPending = true;
      requestAnimationFrame(() => {
        syncPending = false;
        this.syncScrollbar();
      });
    };
    this.cleanups.push(term.onScroll(scheduleSync).dispose);
    this.cleanups.push(term.onWriteParsed(scheduleSync).dispose);

    const onThumbDown = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const buffer = term.buffer.active;
      const maxTop = buffer.length - term.rows;
      if (maxTop <= 0) return;
      const trackHeight = this.scrollbar.clientHeight;
      const thumbHeight = Math.max(28, (term.rows / buffer.length) * trackHeight);
      const range = trackHeight - thumbHeight;
      const startY = event.clientY;
      const startTop = buffer.viewportY;
      this.scrollbar.classList.add('is-dragging');
      const move = (e: MouseEvent): void => {
        const delta = range > 0 ? ((e.clientY - startY) / range) * maxTop : 0;
        term.scrollToLine(Math.max(0, Math.min(maxTop, Math.round(startTop + delta))));
      };
      const up = (): void => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        this.scrollbar.classList.remove('is-dragging');
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    // Klik w tor poza kciukiem — skok do wskazanego miejsca bufora.
    const onTrackDown = (event: MouseEvent): void => {
      const buffer = term.buffer.active;
      const maxTop = buffer.length - term.rows;
      if (maxTop <= 0) return;
      const rect = this.scrollbar.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      term.scrollToLine(Math.max(0, Math.min(maxTop, Math.round(ratio * maxTop))));
    };

    this.thumb.addEventListener('mousedown', onThumbDown);
    this.scrollbar.addEventListener('mousedown', onTrackDown);
    this.cleanups.push(() => {
      this.thumb.removeEventListener('mousedown', onThumbDown);
      this.scrollbar.removeEventListener('mousedown', onTrackDown);
    });
  }

  /** Rozmiar i pozycja kciuka z aktualnego bufora; chowa pasek, gdy całość mieści się w widoku. */
  private syncScrollbar(): void {
    const buffer = this.term.buffer.active;
    const total = buffer.length;
    const rows = this.term.rows;
    if (total <= rows) {
      this.scrollbar.classList.remove('is-visible');
      return;
    }
    this.scrollbar.classList.add('is-visible');

    const trackHeight = this.scrollbar.clientHeight;
    const thumbHeight = Math.max(28, (rows / total) * trackHeight);
    const maxTop = total - rows;
    const thumbTop = maxTop > 0 ? (buffer.viewportY / maxTop) * (trackHeight - thumbHeight) : 0;
    this.thumb.style.height = `${thumbHeight}px`;
    this.thumb.style.transform = `translateY(${Math.round(thumbTop)}px)`;
  }

  private startSession(): void {
    const term = this.term;
    void window.luma.terminal
      .create(this.spec, term.cols, term.rows)
      .catch((error: unknown) => {
        // Otwarcie portu potrafi się nie udać: zajęty przez inny program, wypięty kabel.
        // Użytkownik musi zobaczyć powód, a nie pusty terminal.
        const message = error instanceof Error ? error.message : String(error);
        this.last = { kind: 'error', message };
        this.handlers.onError(message);
        return undefined;
      })
      .then((session) => {
        if (!session) return;
        // Panel mógł zniknąć, zanim sesja wstała — inaczej zostałby sierocy transport.
        if (this.disposed) {
          void window.luma.terminal.dispose(session.sessionId);
          return;
        }

        this.sessionId = session.sessionId;
        this.last = { kind: 'ready', info: { label: session.label, sessionId: session.sessionId } };
        this.handlers.onReady(this.last.info);

        // Udostępnij zaznaczenie i ostatnie wyjście panelowi czatu AI (bez akcji — sam odczyt).
        this.cleanups.push(
          registerTerminal(session.sessionId, {
            getSelection: () => term.getSelection(),
            getRecentText: (maxLines) => {
              const buffer = term.buffer.active;
              const end = buffer.length;
              const start = Math.max(0, end - maxLines);
              const lines: string[] = [];
              for (let i = start; i < end; i++) {
                lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
              }
              return lines.join('\n').replace(/\n+$/, '');
            }
          })
        );

        this.cleanups.push(
          window.luma.terminal.onData((event) => {
            if (event.sessionId !== this.sessionId) return;
            if (this.monitor?.hex) {
              // Widok hex: bajty jako sformatowany zrzut, z wyrównaniem między porcjami.
              this.hex ??= new HexFormatter();
              term.write(this.hex.push(event.data));
            } else if (this.monitor?.timestamps) {
              term.write(timestamp() + new TextDecoder().decode(event.data));
            } else {
              // xterm przyjmuje Uint8Array i sam składa UTF-8 rozjechany między porcjami.
              term.write(event.data);
            }
          })
        );

        this.cleanups.push(
          window.luma.terminal.onExit((event) => {
            if (event.sessionId !== this.sessionId) return;
            this.last = { kind: 'exit', code: event.exitCode };
            this.handlers.onExit(event.exitCode);
          })
        );

        this.cleanups.push(
          term.onData((data) => {
            if (this.sessionId) void window.luma.terminal.write(this.sessionId, data);
          }).dispose
        );

        this.fit();
      });
  }
}

/** Żywe terminale pod kluczem panelu. Klucz jest stabilny przez cały czas życia panelu. */
const instances = new Map<string, TerminalInstance>();

/** Odcisk specyfikacji sesji — zmiana oznacza inne połączenie, więc i inną sesję. */
function specKeyOf(spec: SessionSpec): string {
  return JSON.stringify(spec);
}

/**
 * Zwraca terminal panelu; tworzy go przy pierwszym wywołaniu. Zmiana specyfikacji zamyka
 * starą sesję i otwiera nową — to jedyny przypadek, w którym instancja jest wymieniana.
 */
export function acquireTerminal(paneId: string, init: TerminalInit): TerminalInstance {
  const key = specKeyOf(init.spec);
  const existing = instances.get(paneId);
  if (existing && existing.specKey === key) {
    existing.update({
      settings: init.settings,
      look: init.look,
      monitor: init.monitor,
      handlers: init.handlers
    });
    return existing;
  }
  existing?.dispose();

  const created = new TerminalInstance(paneId, key, init);
  instances.set(paneId, created);
  return created;
}

/**
 * Zamyka terminale paneli, których nie ma już w workspace.
 *
 * To jedyne miejsce, w którym ginie sesja przy pracy z układem: odmontowanie komponentu
 * (podział, zamknięcie sąsiada, przełączenie zakładki) świadomie NIE zamyka niczego, więc
 * sprzątanie musi wynikać ze stanu, a nie z cyklu życia Reacta.
 */
export function disposeTerminalsExcept(alive: ReadonlySet<string>): void {
  for (const [paneId, instance] of instances) {
    if (alive.has(paneId)) continue;
    instance.dispose();
    instances.delete(paneId);
  }
}

// Zamknięcie/przeładowanie okna: proces główny i tak sprząta sesje po utracie renderera,
// ale jawne zamknięcie ucina PTY od razu i nie zostawia procesów na czas przeładowania
// w trybie deweloperskim.
window.addEventListener('beforeunload', () => disposeTerminalsExcept(new Set()));
