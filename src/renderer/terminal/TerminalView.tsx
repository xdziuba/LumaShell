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

interface TerminalViewProps {
  onReady: (info: { shell: string }) => void;
  onExit: (exitCode: number) => void;
}

export function TerminalView({ onReady, onExit }: TerminalViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  // Callbacki trzymane w ref, żeby efekt nie restartował sesji przy każdym renderze.
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  onReadyRef.current = onReady;
  onExitRef.current = onExit;

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
    try {
      term.loadAddon(new WebglAddon());
    } catch (error) {
      console.warn('[terminal] WebGL niedostępny, renderer zapasowy:', error);
    }

    fit.fit();

    let sessionId: string | undefined;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    void window.luma.terminal.create(term.cols, term.rows).then((session) => {
      // Komponent mógł zniknąć zanim sesja wstała — inaczej zostałby sierocy PTY.
      if (disposed) {
        void window.luma.terminal.dispose(session.sessionId);
        return;
      }

      sessionId = session.sessionId;
      onReadyRef.current({ shell: session.shell });

      cleanups.push(
        window.luma.terminal.onData((event) => {
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
  }, []);

  return <div className="terminal" ref={hostRef} />;
}
