/**
 * Rekurencyjny widok drzewa paneli (Etap 2 — podziały).
 *
 * Liść to jedna sesja terminala; split dzieli obszar na dwoje z przeciąganą granicą.
 * Struktura drzewa i jej zmiany są w `core/workspace/pane-tree`; tu tylko render.
 */

import { useRef } from 'react';
import { TerminalView, type RendererKind } from '../terminal/TerminalView';
import type { Pane, SplitDirection } from '@core/workspace/pane-tree';
import type { TerminalSettings } from '@shared/types/settings';

export interface PaneCallbacks {
  settings: TerminalSettings;
  /** Czy zakładka tego drzewa jest na wierzchu — steruje widocznością i dopasowaniem. */
  tabActive: boolean;
  activePaneId: string;
  onReady: (paneId: string, label: string, sessionId: string) => void;
  onExit: (paneId: string, code: number | undefined) => void;
  onError: (paneId: string, message: string) => void;
  onRenderer: (kind: RendererKind) => void;
  onFocus: (paneId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
}

export function PaneView({ node, cb }: { node: Pane; cb: PaneCallbacks }): React.JSX.Element {
  if (node.kind === 'leaf') {
    const focused = cb.tabActive && node.id === cb.activePaneId;
    return (
      <div
        className={`pane${focused ? ' pane--focused' : ''}`}
        // mousedown w fazie bąbelkowania: klik w dowolny panel nadaje mu fokus.
        onMouseDown={() => cb.onFocus(node.id)}
      >
        <TerminalView
          spec={node.spec}
          settings={cb.settings}
          active={cb.tabActive}
          monitor={node.monitor}
          onReady={(info) => cb.onReady(node.id, info.label, info.sessionId)}
          onExit={(code) => cb.onExit(node.id, code)}
          onRenderer={cb.onRenderer}
          onError={(message) => cb.onError(node.id, message)}
        />
      </div>
    );
  }
  return <SplitView node={node} direction={node.direction} cb={cb} />;
}

function SplitView({
  node,
  direction,
  cb
}: {
  node: Extract<Pane, { kind: 'split' }>;
  direction: SplitDirection;
  cb: PaneCallbacks;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerDown = (event: React.MouseEvent): void => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const move = (e: MouseEvent): void => {
      const rect = container.getBoundingClientRect();
      const ratio =
        direction === 'row'
          ? (e.clientX - rect.left) / rect.width
          : (e.clientY - rect.top) / rect.height;
      cb.onResize(node.id, ratio);
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    // Kursor na całym oknie w trakcie ciągnięcia — inaczej migałby nad terminalem.
    document.body.style.cursor = direction === 'row' ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const first = `${node.ratio * 100}%`;
  const second = `${(1 - node.ratio) * 100}%`;

  return (
    <div ref={containerRef} className={`split split--${direction}`}>
      <div className="split__child" style={{ flexBasis: first }}>
        <PaneView node={node.a} cb={cb} />
      </div>
      <div
        className={`split__divider split__divider--${direction}`}
        onMouseDown={onDividerDown}
        role="separator"
      />
      <div className="split__child" style={{ flexBasis: second }}>
        <PaneView node={node.b} cb={cb} />
      </div>
    </div>
  );
}
