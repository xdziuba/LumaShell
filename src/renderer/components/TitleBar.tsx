/**
 * Własny pasek tytułu.
 *
 * Rysujemy wyłącznie treść paska. Przyciski okna są natywne (Window Controls Overlay),
 * bo tylko wtedy działa Snap Layouts — patrz docs/architecture/10-decyzje.md.
 * Szerokość zajętą przez natywne przyciski oddaje CSS przez `env(titlebar-area-width)`.
 */

export function TitleBar({ subtitle }: { subtitle: string }): React.JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar__content">
        <span className="titlebar__dot" />
        <span className="titlebar__title">LumaShell — {subtitle}</span>
      </div>
    </header>
  );
}
