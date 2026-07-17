/**
 * Własny pasek tytułu z własnymi przyciskami okna (kolorowe kółka).
 *
 * Rezygnujemy z natywnego Window Controls Overlay (a z nim ze Snap Layouts) na rzecz
 * spójnej estetyki — aktualizacja decyzji D1 (docs/architecture/10-decyzje.md). Przyciski
 * sterują oknem przez IPC; region drag pozwala przesuwać okno, przyciski są no-drag.
 */

import { useEffect, useState } from 'react';
import logoUrl from '../assets/logo-128.png';
import { IconWinClose, IconWinMaximize, IconWinMinimize, IconWinRestore } from './icons';

export function TitleBar({ subtitle }: { subtitle: string }): React.JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.luma.window.isMaximized().then(setMaximized);
    return window.luma.window.onMaximizedChanged(setMaximized);
  }, []);

  return (
    <header className="titlebar">
      <div className="titlebar__content">
        <img className="titlebar__logo" src={logoUrl} alt="LumaShell" draggable={false} />
        <span className="titlebar__brand">LumaShell</span>
        <span className="titlebar__sep" aria-hidden="true" />
        <span className="titlebar__title">{subtitle}</span>

        <div className="titlebar__controls">
          <button
            className="titlebar__ctrl titlebar__ctrl--min"
            onClick={() => window.luma.window.minimize()}
            aria-label="Minimalizuj"
            title="Minimalizuj"
          >
            <IconWinMinimize />
          </button>
          <button
            className="titlebar__ctrl titlebar__ctrl--max"
            onClick={() => window.luma.window.maximizeToggle()}
            aria-label={maximized ? 'Przywróć' : 'Maksymalizuj'}
            title={maximized ? 'Przywróć' : 'Maksymalizuj'}
          >
            {maximized ? <IconWinRestore /> : <IconWinMaximize />}
          </button>
          <button
            className="titlebar__ctrl titlebar__ctrl--close"
            onClick={() => window.luma.window.close()}
            aria-label="Zamknij"
            title="Zamknij"
          >
            <IconWinClose />
          </button>
        </div>
      </div>
    </header>
  );
}
