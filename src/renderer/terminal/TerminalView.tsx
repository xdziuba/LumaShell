/**
 * Terminal xterm.js z rendererem WebGL, podpięty do sesji PTY przez IPC.
 *
 * Renderer nie wie, że po drugiej stronie jest node-pty — rozmawia wyłącznie
 * z wąskim API preloadu (docs/architecture/02-warstwy-i-transporty.md).
 */

import { useCallback, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { HexFormatter, timestamp } from './hex-format';
import type { MonitorMode, SessionSpec } from '@shared/types/ipc';
import type { TerminalSettings } from '@shared/types/settings';

export type RendererKind = 'webgl' | 'canvas';

/**
 * Alfa tła terminala.
 *
 * Tło xterm jest w PEŁNI przezroczyste (0): całe tło niesie jednolita tafla `.terminal`
 * (glass w SCSS). Dzięki temu padding i obszar tekstu wyglądają identycznie — nie ma
 * „podwójnej ramki" (płótno WebGL malowałoby tint tylko pod tekstem). Kontrast trzyma tafla
 * + przyciemnienie tapety (docs/architecture/03-interfejs-i-motywy.md).
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

interface TerminalViewProps {
  /** Zmiana specyfikacji zamyka poprzednią sesję i otwiera nową. */
  spec: SessionSpec;
  settings: TerminalSettings;
  /**
   * Czy zakładka jest na wierzchu.
   *
   * Nieaktywne terminale zostają zamontowane — ich powłoki mają działać dalej — ale są
   * ukryte i nie przeliczają wymiarów (docs/architecture/05-wydajnosc.md).
   */
  active: boolean;
  /** Tryb monitora — gdy podany, dane są przetwarzane (hex / znaczniki czasu). */
  monitor?: MonitorMode;
  /** Kolory terminala z aktywnego motywu (xterm nie czyta CSS). */
  terminalTheme: { background: string; foreground: string; cursor: string; selection: string };
  onReady: (info: { label: string; sessionId: string }) => void;
  onExit: (exitCode: number | undefined) => void;
  onRenderer: (kind: RendererKind) => void;
  onError: (message: string) => void;
}

export function TerminalView({
  spec,
  settings,
  active,
  monitor,
  terminalTheme,
  onReady,
  onExit,
  onRenderer,
  onError
}: TerminalViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Własny scrollbar: xterm z WebGL nie przepełnia viewportu, więc rysujemy nakładkę
  // synchronizowaną z buforem (pojawia się przy overflow, przeciągalna; kółko działa dalej).
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  // Ustawienia w ref, żeby nie weszły do zależności efektu montującego — inaczej
  // zmiana rozmiaru czcionki ubiłaby powłokę i otworzyła nową sesję.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Identyfikator sesji w refie: czyta go zarowno efekt montujacy, jak i efekt ustawien.
  const sessionIdRef = useRef<string | undefined>(undefined);
  // Callbacki trzymane w ref, żeby efekt nie restartował sesji przy każdym renderze.
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  const onRendererRef = useRef(onRenderer);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onExitRef.current = onExit;
  onRendererRef.current = onRenderer;
  onErrorRef.current = onError;
  // Tryb monitora w refie — zmiana nie może restartować sesji.
  const monitorRef = useRef(monitor);
  const hexRef = useRef<HexFormatter | null>(null);
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;

  /**
   * Odświeżenie własnego scrollbara: rozmiar i pozycja kciuka z aktualnego bufora xterm.
   * Chowa scrollbar, gdy całość mieści się w widoku.
   */
  const syncScrollbar = useCallback((): void => {
    const term = termRef.current;
    const scrollbar = scrollbarRef.current;
    const thumb = thumbRef.current;
    if (!term || !scrollbar || !thumb) return;

    const buffer = term.buffer.active;
    const total = buffer.length;
    const rows = term.rows;
    if (total <= rows) {
      scrollbar.classList.remove('is-visible');
      return;
    }
    scrollbar.classList.add('is-visible');

    const trackHeight = scrollbar.clientHeight;
    const thumbHeight = Math.max(28, (rows / total) * trackHeight);
    const maxTop = total - rows;
    const thumbTop = maxTop > 0 ? (buffer.viewportY / maxTop) * (trackHeight - thumbHeight) : 0;
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${Math.round(thumbTop)}px)`;
  }, []);

  /**
   * Dopasowanie terminala do kontenera i przekazanie nowego rozmiaru do sesji.
   *
   * Sięga wyłącznie po refy, więc jest stabilne i nie wciąga efektów w przeliczanie.
   */
  const dopasuj = useCallback((): void => {
    const host = hostRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!host || !term || !fit) return;

    // Ukryta zakładka ma zerowe wymiary. `fit()` policzyłby z nich bezsensowną liczbę
    // kolumn i wierszy, a potem wysłał ją do PTY — powłoka zobaczyłaby okno 1×1.
    if (host.clientWidth === 0 || host.clientHeight === 0) return;

    fit.fit();
    const id = sessionIdRef.current;
    if (id) void window.luma.terminal.resize(id, term.cols, term.rows);
    syncScrollbar();
  }, [syncScrollbar]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initial = settingsRef.current;
    const term = new Terminal({
      fontFamily: `${initial.fontFamily}, Consolas, monospace`,
      fontSize: initial.fontSize,
      lineHeight: initial.lineHeight,
      letterSpacing: initial.letterSpacing,
      cursorBlink: initial.cursorBlink,
      scrollback: initial.scrollback,
      allowProposedApi: true,
      // Terminal jako powierzchnia glass: tło półprzezroczyste, tapeta prześwituje.
      allowTransparency: true,
      theme: {
        background: withAlpha(terminalThemeRef.current.background, TERM_ALPHA),
        foreground: terminalThemeRef.current.foreground,
        cursor: terminalThemeRef.current.cursor,
        selectionBackground: terminalThemeRef.current.selection
      }
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // WebGL bywa niedostępny (sterowniki, zdalny pulpit). Terminal ma wtedy nadal działać
    // na rendererze canvas — docs/architecture/05-wydajnosc.md. Cichy fallback wygląda
    // identycznie jak działający WebGL, więc wynik raportujemy na zewnątrz.
    try {
      const webgl = new WebglAddon();
      // Kontekst GPU potrafi paść (uśpienie, zmiana sterownika, zdalny pulpit).
      webgl.onContextLoss(() => {
        console.warn('[terminal] utracono kontekst WebGL — przejście na renderer zapasowy');
        webgl.dispose();
        onRendererRef.current('canvas');
      });
      term.loadAddon(webgl);
      onRendererRef.current('webgl');
    } catch (error) {
      console.warn('[terminal] WebGL niedostępny, renderer zapasowy:', error);
      onRendererRef.current('canvas');
    }

    dopasuj();

    let disposed = false;
    const cleanups: Array<() => void> = [];

    const wklej = async (): Promise<void> => {
      const tekst = await navigator.clipboard.readText();
      if (sessionIdRef.current && tekst) await window.luma.terminal.write(sessionIdRef.current, tekst);
    };

    // Ctrl+C w terminalu musi zostać przerwaniem procesu, a nie kopiowaniem — dlatego
    // kopiuje dopiero Ctrl+Shift+C. Wyjątek: gdy coś jest zaznaczone, samo Ctrl+C
    // kopiuje, bo tego oczekuje każdy użytkownik Windows.
    // Zwraca void, nie disposable — handler znika razem z `term.dispose()`.
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
    host.addEventListener('contextmenu', menuKontekstowe);
    cleanups.push(() => host.removeEventListener('contextmenu', menuKontekstowe));

    // Własny scrollbar: aktualizuj przy przewijaniu i po zapisie, throttlowane do klatki.
    let syncPending = false;
    const scheduleSync = (): void => {
      if (syncPending) return;
      syncPending = true;
      requestAnimationFrame(() => {
        syncPending = false;
        syncScrollbar();
      });
    };
    cleanups.push(term.onScroll(scheduleSync).dispose);
    cleanups.push(term.onWriteParsed(scheduleSync).dispose);
    const scrollbar = scrollbarRef.current;
    const thumb = thumbRef.current;
    if (scrollbar && thumb) {
      const onThumbDown = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        const buffer = term.buffer.active;
        const maxTop = buffer.length - term.rows;
        if (maxTop <= 0) return;
        const trackHeight = scrollbar.clientHeight;
        const thumbHeight = Math.max(28, (term.rows / buffer.length) * trackHeight);
        const range = trackHeight - thumbHeight;
        const startY = event.clientY;
        const startTop = buffer.viewportY;
        scrollbar.classList.add('is-dragging');
        const move = (e: MouseEvent): void => {
          const delta = range > 0 ? ((e.clientY - startY) / range) * maxTop : 0;
          term.scrollToLine(Math.max(0, Math.min(maxTop, Math.round(startTop + delta))));
        };
        const up = (): void => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          scrollbar.classList.remove('is-dragging');
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      };
      // Klik w tor poza kciukiem — skok do wskazanego miejsca bufora.
      const onTrackDown = (event: MouseEvent): void => {
        const buffer = term.buffer.active;
        const maxTop = buffer.length - term.rows;
        if (maxTop <= 0) return;
        const rect = scrollbar.getBoundingClientRect();
        const ratio = (event.clientY - rect.top) / rect.height;
        term.scrollToLine(Math.max(0, Math.min(maxTop, Math.round(ratio * maxTop))));
      };
      thumb.addEventListener('mousedown', onThumbDown);
      scrollbar.addEventListener('mousedown', onTrackDown);
      cleanups.push(() => {
        thumb.removeEventListener('mousedown', onThumbDown);
        scrollbar.removeEventListener('mousedown', onTrackDown);
      });
    }

    void window.luma.terminal
      .create(spec, term.cols, term.rows)
      .catch((error: unknown) => {
        // Otwarcie portu potrafi się nie udać: zajęty przez inny program, wypięty kabel.
        // Użytkownik musi zobaczyć powód, a nie pusty terminal.
        onErrorRef.current(error instanceof Error ? error.message : String(error));
        return undefined;
      })
      .then((session) => {
        if (!session) return;
        // Komponent mógł zniknąć zanim sesja wstała — inaczej zostałby sierocy transport.
        if (disposed) {
          void window.luma.terminal.dispose(session.sessionId);
          return;
        }

        sessionIdRef.current = session.sessionId;
        onReadyRef.current({ label: session.label, sessionId: session.sessionId });

        cleanups.push(
          window.luma.terminal.onData((event) => {
            if (event.sessionId !== sessionIdRef.current) return;
            const mode = monitorRef.current;
            if (mode?.hex) {
              // Widok hex: bajty jako zrfmt. zrzut, z zachowaniem wyrównania między porcjami.
              hexRef.current ??= new HexFormatter();
              term.write(hexRef.current.push(event.data));
            } else if (mode?.timestamps) {
              // Tryb tekstowy ze znacznikiem czasu na początku każdej porcji.
              term.write(timestamp() + new TextDecoder().decode(event.data));
            } else {
              // xterm przyjmuje Uint8Array i sam składa UTF-8 rozjechany między porcjami.
              term.write(event.data);
            }
          })
        );

        cleanups.push(
          window.luma.terminal.onExit((event) => {
            if (event.sessionId === sessionIdRef.current) onExitRef.current(event.exitCode);
          })
        );

        cleanups.push(
          term.onData((data) => {
            const id = sessionIdRef.current;
          if (id) void window.luma.terminal.write(id, data);
          }).dispose
        );
      });

    // Ukrycie zakładki też odpala obserwator (wymiary spadają do zera) — dopasuj()
    // taki przypadek odsiewa.
    const observer = new ResizeObserver(dopasuj);
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      for (const cleanup of cleanups) cleanup();
      const id = sessionIdRef.current;
      if (id) void window.luma.terminal.dispose(id);
      sessionIdRef.current = undefined;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Zmiana specyfikacji celowo przebudowuje terminal: stara sesja jest zamykana,
    // nowa otwierana od zera.
  }, [spec, dopasuj, syncScrollbar]);

  // Ustawienia stosowane na żywo, bez dotykania sesji. Zmiana rozmiaru czcionki
  // zmienia liczbę kolumn i wierszy, więc PTY musi dostać nowy rozmiar.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    term.options.fontFamily = `${settings.fontFamily}, Consolas, monospace`;
    term.options.fontSize = settings.fontSize;
    term.options.lineHeight = settings.lineHeight;
    term.options.letterSpacing = settings.letterSpacing;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;

    dopasuj();
  }, [settings, dopasuj]);

  // Powrót na wierzch: kontener dopiero teraz odzyskał wymiary, więc terminal trzeba
  // przeliczyć — w tle nie było z czego.
  useEffect(() => {
    if (active) dopasuj();
  }, [active, dopasuj]);

  // Zmiana motywu na żywo — kolory terminala, bez restartu sesji.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = {
      background: withAlpha(terminalTheme.background, TERM_ALPHA),
      foreground: terminalTheme.foreground,
      cursor: terminalTheme.cursor,
      selectionBackground: terminalTheme.selection
    };
  }, [terminalTheme]);

  // Zmiana trybu monitora: domknij niepełną linię hex i zaznacz przełączenie, żeby
  // dane sprzed i po zmianie się nie zlewały.
  useEffect(() => {
    const term = termRef.current;
    const prev = monitorRef.current;
    monitorRef.current = monitor;
    if (!term) return;
    if (prev?.hex && !monitor?.hex && hexRef.current) {
      term.write(hexRef.current.flush());
      hexRef.current = null;
    }
    if (monitor?.hex) hexRef.current ??= new HexFormatter();
  }, [monitor?.hex, monitor?.timestamps]);

  return (
    // Ukryta zakładka zostaje zamontowana (jej powłoka ma żyć dalej), ale znika dla
    // czytników ekranu. xterm montuje się w .term-host; scrollbar to nakładka po prawej.
    // Klasa .term-pane (nie .terminal!) — xterm.js sam dodaje klasę „terminal" do swojego
    // korzenia, więc kolizja dawała podwójną ramkę i psuła przewijanie.
    <div className={`term-pane${active ? '' : ' term-pane--hidden'}`} aria-hidden={!active}>
      <div className="term-host" ref={hostRef} />
      <div className="term-scrollbar" ref={scrollbarRef}>
        <div className="term-scrollbar__thumb" ref={thumbRef} />
      </div>
    </div>
  );
}
