/**
 * Własny pasek tytułu.
 *
 * Konsekwencja decyzji D1 (`frame: false`): system nie rysuje już ramy, więc pasek,
 * przyciski i obszar przeciągania są po naszej stronie
 * (docs/architecture/10-decyzje.md).
 */

import { useEffect, useState } from 'react';

/** Glify z Segoe Fluent Icons / Segoe MDL2 Assets — standardowe ikony okna Windows. */
const Glyph = {
  Minimize: '\uE921',
  Maximize: '\uE922',
  Restore: '\uE923',
  Close: '\uE8BB'
} as const;

export function TitleBar({ subtitle }: { subtitle: string }): React.JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => window.luma.window.onMaximizedChanged(setMaximized), []);

  return (
    <header className="titlebar">
      <span className="titlebar__dot" />
      <span className="titlebar__title">LumaShell — {subtitle}</span>

      <div className="titlebar__controls">
        <button
          className="titlebar__button titlebar__button--glyph"
          onClick={() => void window.luma.window.minimize()}
          aria-label="Minimalizuj"
        >
          {Glyph.Minimize}
        </button>
        <button
          className="titlebar__button titlebar__button--glyph"
          onClick={() => void window.luma.window.toggleMaximize()}
          aria-label={maximized ? 'Przywróć' : 'Maksymalizuj'}
        >
          {maximized ? Glyph.Restore : Glyph.Maximize}
        </button>
        <button
          className="titlebar__button titlebar__button--glyph titlebar__button--close"
          onClick={() => void window.luma.window.close()}
          aria-label="Zamknij"
        >
          {Glyph.Close}
        </button>
      </div>
    </header>
  );
}
