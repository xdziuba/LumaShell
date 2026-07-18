/**
 * Dropup — przycisk toolbara, który rozwija listę „do góry" (Etap UI).
 *
 * Dolny pasek jest szybkim toolbarem: część akcji z czasem urośnie w rozwijane listy
 * z dodatkowymi funkcjami. Ten komponent daje wzorzec — menu otwiera się nad przyciskiem,
 * zamyka klikiem obok albo Esc. `children` dostaje `close`, żeby akcja mogła je zamknąć.
 */

import { useEffect, useRef, useState } from 'react';

interface DropupProps {
  label: React.ReactNode;
  title?: string;
  /** Wyrównanie menu: 'right' (domyślne, akcje po prawej) albo 'left' (menu kategorii). */
  align?: 'left' | 'right';
  /** Styl przycisku: 'button' (akcja w toolbarze) albo 'category' (Plik/Widok/…). */
  variant?: 'button' | 'category';
  children: (close: () => void) => React.ReactNode;
}

export function Dropup({
  label,
  title,
  align = 'right',
  variant = 'button',
  children
}: DropupProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = (): void => setOpen(false);

  return (
    <div className="dropup" ref={ref}>
      {open && <div className={`dropup__menu dropup__menu--${align}`}>{children(close)}</div>}
      <button
        className={
          variant === 'category'
            ? `dropup__cat${open ? ' is-active' : ''}`
            : `statusbar__button dropup__toggle${open ? ' is-active' : ''}`
        }
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
      </button>
    </div>
  );
}
