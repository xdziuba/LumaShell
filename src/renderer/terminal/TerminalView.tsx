/**
 * Panel terminala — cienka warstwa Reacta nad trwałą instancją xterm.
 *
 * Sam xterm i sesja PTY żyją w `terminal-instance` pod kluczem panelu, POZA drzewem Reacta.
 * Ten komponent tylko udostępnia taflę, przypina do niej elementy terminala i przekazuje
 * dalej ustawienia, motyw i tryb monitora. Dzięki temu przebudowa drzewa paneli (podział,
 * zamknięcie sąsiada) nie zabija trwającej powłoki — patrz komentarz w terminal-instance.ts.
 *
 * Renderer nie wie, że po drugiej stronie jest node-pty — rozmawia wyłącznie z wąskim API
 * preloadu (docs/architecture/02-warstwy-i-transporty.md).
 */

import { useEffect, useMemo, useRef } from 'react';
import { acquireTerminal, type RendererKind, type TerminalHandlers, type TerminalInstance, type TerminalLook } from './terminal-instance';
import type { MonitorMode, SessionSpec } from '@shared/types/ipc';
import type { TerminalSettings } from '@shared/types/settings';

export type { RendererKind };

interface TerminalViewProps {
  /** Klucz panelu w drzewie — pod nim żyje instancja terminala. */
  paneId: string;
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
  terminalTheme: TerminalLook;
  onReady: (info: { label: string; sessionId: string }) => void;
  onExit: (exitCode: number | undefined) => void;
  onRenderer: (kind: RendererKind) => void;
  onError: (message: string) => void;
}

export function TerminalView({
  paneId,
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
  const paneRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TerminalInstance | null>(null);

  // Callbacki w refie + pośrednik o stabilnej tożsamości: instancja przeżywa przemontowanie
  // komponentu, więc nie może trzymać nieaktualnych domknięć ani wymuszać ponownego
  // przypinania przy każdym renderze.
  const cbRef = useRef({ onReady, onExit, onRenderer, onError });
  cbRef.current = { onReady, onExit, onRenderer, onError };
  const handlers = useRef<TerminalHandlers>({
    onReady: (info) => cbRef.current.onReady(info),
    onExit: (code) => cbRef.current.onExit(code),
    onRenderer: (kind) => cbRef.current.onRenderer(kind),
    onError: (message) => cbRef.current.onError(message)
  }).current;

  // Stan „na teraz" dla pierwszego utworzenia instancji — bez wciągania go w zależności.
  const live = useRef({ settings, terminalTheme, monitor });
  live.current = { settings, terminalTheme, monitor };

  const specKey = useMemo(() => JSON.stringify(spec), [spec]);

  useEffect(() => {
    const parent = paneRef.current;
    if (!parent) return;

    const instance = acquireTerminal(paneId, {
      spec,
      settings: live.current.settings,
      look: live.current.terminalTheme,
      monitor: live.current.monitor,
      handlers
    });
    instanceRef.current = instance;
    instance.attach(parent);

    // Odmontowanie tylko ODPINA terminal. Sesję zamyka dopiero zniknięcie panelu
    // z workspace'u (disposeTerminalsExcept w App).
    return () => instance.detach();
    // `spec` jest odwzorowane przez `specKey` — inna specyfikacja to inna sesja.
  }, [paneId, specKey, handlers]);

  useEffect(() => {
    instanceRef.current?.update({ settings, look: terminalTheme, monitor, handlers });
  }, [settings, terminalTheme, monitor, handlers]);

  // Powrót na wierzch: kontener dopiero teraz odzyskał wymiary, więc terminal trzeba
  // przeliczyć — w tle nie było z czego. Zapamiętujemy też sesję jako ostatnio aktywną,
  // żeby panel czatu wiedział, z którego terminala brać wyjście.
  useEffect(() => {
    if (active) instanceRef.current?.activate();
  }, [active]);

  return (
    // Ukryta zakładka zostaje zamontowana (jej powłoka ma żyć dalej), ale znika dla
    // czytników ekranu. Klasa .term-pane (nie .terminal!) — xterm.js sam dodaje klasę
    // „terminal" do swojego korzenia, więc kolizja dawała podwójną ramkę i psuła przewijanie.
    // Wnętrze (.term-host + .term-scrollbar) należy do instancji, nie do Reacta.
    <div
      className={`term-pane${active ? '' : ' term-pane--hidden'}`}
      aria-hidden={!active}
      ref={paneRef}
    />
  );
}
