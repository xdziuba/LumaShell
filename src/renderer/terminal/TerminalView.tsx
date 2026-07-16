/**
 * Terminal xterm.js z rendererem WebGL, podpięty do sesji PTY przez IPC.
 *
 * Renderer nie wie, że po drugiej stronie jest node-pty — rozmawia wyłącznie
 * z wąskim API preloadu (docs/architecture/02-warstwy-i-transporty.md).
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { SessionSpec } from '@shared/types/ipc';

export type RendererKind = 'webgl' | 'canvas';

interface TerminalViewProps {
  /** Zmiana specyfikacji zamyka poprzednią sesję i otwiera nową. */
  spec: SessionSpec;
  onReady: (info: { label: string }) => void;
  onExit: (exitCode: number | undefined) => void;
  onRenderer: (kind: RendererKind) => void;
  onError: (message: string) => void;
}

export function TerminalView({
  spec,
  onReady,
  onExit,
  onRenderer,
  onError
}: TerminalViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  // Callbacki trzymane w ref, żeby efekt nie restartował sesji przy każdym renderze.
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  const onRendererRef = useRef(onRenderer);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onExitRef.current = onExit;
  onRendererRef.current = onRenderer;
  onErrorRef.current = onError;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#06100C',
        foreground: '#DFFFF0',
        cursor: '#21E68A',
        selectionBackground: 'rgba(33, 230, 138, 0.25)'
      }
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // WebGL bywa niedostępny (sterowniki, zdalny pulpit). Terminal ma wtedy nadal
    // działać na rendererze canvas — docs/architecture/05-wydajnosc.md.
    //
    // Wynik jest raportowany na zewnątrz, bo cichy fallback wygląda identycznie jak
    // działający WebGL i skrywałby utratę wydajności.
    try {
      const webgl = new WebglAddon();

      // Kontekst GPU potrafi paść (uśpienie, zmiana sterownika, zdalny pulpit).
      // Bez tego terminal zamarłby na martwym canvasie zamiast zejść na zapasowy.
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

    fit.fit();

    let sessionId: string | undefined;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    const wklej = async (): Promise<void> => {
      const tekst = await navigator.clipboard.readText();
      if (sessionId && tekst) await window.luma.terminal.write(sessionId, tekst);
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

        sessionId = session.sessionId;
        onReadyRef.current({ label: session.label });

        cleanups.push(
          window.luma.terminal.onData((event) => {
            // xterm przyjmuje Uint8Array i sam składa UTF-8 rozjechany między porcjami.
            if (event.sessionId === sessionId) term.write(event.data);
          })
        );

        cleanups.push(
          window.luma.terminal.onExit((event) => {
            if (event.sessionId === sessionId) onExitRef.current(event.exitCode);
          })
        );

        cleanups.push(
          term.onData((data) => {
            if (sessionId) void window.luma.terminal.write(sessionId, data);
          }).dispose
        );
      });

    const resize = (): void => {
      fit.fit();
      if (sessionId) void window.luma.terminal.resize(sessionId, term.cols, term.rows);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      for (const cleanup of cleanups) cleanup();
      if (sessionId) void window.luma.terminal.dispose(sessionId);
      term.dispose();
    };
    // Zmiana specyfikacji celowo przebudowuje terminal: stara sesja jest zamykana,
    // nowa otwierana od zera.
  }, [spec]);

  return <div className="terminal" ref={hostRef} />;
}
