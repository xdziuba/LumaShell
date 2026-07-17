/**
 * Własny pasek tytułu.
 *
 * Rysujemy wyłącznie treść paska. Przyciski okna są natywne (Window Controls Overlay),
 * bo tylko wtedy działa Snap Layouts — patrz docs/architecture/10-decyzje.md.
 * Szerokość zajętą przez natywne przyciski oddaje CSS przez `env(titlebar-area-width)`.
 */

import logoUrl from '../assets/logo-128.png';

export function TitleBar({ subtitle }: { subtitle: string }): React.JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar__content">
        <img className="titlebar__logo" src={logoUrl} alt="LumaShell" draggable={false} />
        <span className="titlebar__brand">LumaShell</span>
        <span className="titlebar__sep" aria-hidden="true" />
        <span className="titlebar__title">{subtitle}</span>
      </div>
    </header>
  );
}
