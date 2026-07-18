/**
 * Zestaw ikon SVG (Etap UI).
 *
 * Ikony liniowe w stylu Lucide: 16×16, `currentColor`, stroke 1.5 — dziedziczą kolor po
 * tekście, więc reagują na stan (hover, status). Zgodnie z wytycznymi: ikony jako SVG, nigdy
 * emoji (docs — ui-ux-pro-max: no emoji as icons).
 */

import type { SessionSpec } from '@shared/types/ipc';
import type { PanelKind } from '../panels/kinds';

type IconProps = { className?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
};

/** Powłoka lokalna / PTY — motyw `>_`. */
export function IconTerminal({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 4.5 6.5 8l-3 3.5" />
      <path d="M8.5 11.5H13" />
    </svg>
  );
}

/** Port szeregowy / COM — złącze z pinami. */
export function IconSerial({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="5" width="11" height="6" rx="1.5" />
      <path d="M5 5V3.5M8 5V3.5M11 5V3.5" />
    </svg>
  );
}

/** SSH — serwer/stos. */
export function IconSsh({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="3" width="11" height="4" rx="1" />
      <rect x="2.5" y="9" width="11" height="4" rx="1" />
      <path d="M5 5h.01M5 11h.01" />
    </svg>
  );
}

/** Sieć — węzły połączone. */
export function IconNetwork({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="3.5" r="1.6" />
      <circle cx="3.5" cy="12" r="1.6" />
      <circle cx="12.5" cy="12" r="1.6" />
      <path d="M8 5.1v3M6.8 8 4.4 10.6M9.2 8l2.4 2.6" />
    </svg>
  );
}

/** Kontener — sześcian. */
export function IconContainer({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M8 2.2 13 5v6L8 13.8 3 11V5z" />
      <path d="M3 5l5 2.8L13 5M8 7.8v6" />
    </svg>
  );
}

/** Profil — zakładka/bookmark. */
export function IconProfile({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M4 2.75h8v10.5l-4-3-4 3z" />
    </svg>
  );
}

/** Plus — akcje „nowe". */
export function IconPlus({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

// --- Glify sterowania oknem (małe, na kolorowych kółkach) ---

const win = {
  width: 8,
  height: 8,
  viewBox: '0 0 8 8',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
};

export function IconWinMinimize(): React.JSX.Element {
  return (
    <svg {...win}>
      <path d="M1.5 4h5" />
    </svg>
  );
}

export function IconWinMaximize(): React.JSX.Element {
  return (
    <svg {...win}>
      <rect x="1.6" y="1.6" width="4.8" height="4.8" rx="1" />
    </svg>
  );
}

export function IconWinRestore(): React.JSX.Element {
  return (
    <svg {...win}>
      <rect x="1.4" y="2.6" width="4" height="4" rx="0.8" />
      <path d="M3 2.6V1.4h4v4H5.4" />
    </svg>
  );
}

export function IconWinClose(): React.JSX.Element {
  return (
    <svg {...win}>
      <path d="M2 2l4 4M6 2l-4 4" />
    </svg>
  );
}

// --- Ikony paneli (zakładki bez sesji) ---

/** Ustawienia — zębatka. */
export function IconSettings({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4" />
    </svg>
  );
}

/** Motywy — paleta/kropla. */
export function IconPalette({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M8 2.2c3.2 0 5.8 2.3 5.8 5.1 0 1.7-1.4 2.6-2.8 2.6H9.7c-.7 0-1.2.6-1.2 1.2 0 .3.1.5.3.8.2.3.3.5.3.8 0 .6-.5 1.1-1.4 1.1-3.2 0-5.8-2.6-5.8-5.8S4.8 2.2 8 2.2Z" />
      <path d="M5.5 7h.01M8 5h.01M10.5 7h.01" />
    </svg>
  );
}

/** Wtyczki — puzzel. */
export function IconPuzzle({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M6.4 2.6h3.2v1.5a1.1 1.1 0 1 0 2.2 0V2.6h1.6v3.2h-1.5a1.1 1.1 0 1 0 0 2.2h1.5v3.2h-3.2v-1.5a1.1 1.1 0 1 0-2.2 0v1.5H2.6V8.4h1.5a1.1 1.1 0 1 0 0-2.2H2.6V2.6z" />
    </svg>
  );
}

/** O aplikacji — info. */
export function IconInfo({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.4M8 5.1h.01" />
    </svg>
  );
}

/** Skróty — klawiatura. */
export function IconKeyboard({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="1.6" y="4" width="12.8" height="8" rx="1.5" />
      <path d="M4 6.4h.01M6.2 6.4h.01M8.4 6.4h.01M10.6 6.4h.01M5 9.4h6" />
    </svg>
  );
}

/** Nowości — iskra. */
export function IconSparkle({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M8 1.8c.4 2.7 1.7 4 4.4 4.4-2.7.4-4 1.7-4.4 4.4-.4-2.7-1.7-4-4.4-4.4C6.3 5.8 7.6 4.5 8 1.8Z" />
      <path d="M12.5 10.5c.2 1.1.7 1.6 1.8 1.8-1.1.2-1.6.7-1.8 1.8-.2-1.1-.7-1.6-1.8-1.8 1.1-.2 1.6-.7 1.8-1.8Z" />
    </svg>
  );
}

/** Ikona pasująca do rodzaju sesji — używana w tabach i na pasku bocznym. */
export function SessionIcon({ kind, className }: { kind: SessionSpec['kind']; className?: string }): React.JSX.Element {
  switch (kind) {
    case 'serial':
      return <IconSerial className={className} />;
    case 'ssh':
      return <IconSsh className={className} />;
    case 'network':
      return <IconNetwork className={className} />;
    case 'container':
      return <IconContainer className={className} />;
    default:
      return <IconTerminal className={className} />;
  }
}

/** Ikona pasująca do rodzaju panelu (zakładka bez sesji). */
export function PanelIcon({ panel, className }: { panel: PanelKind; className?: string }): React.JSX.Element {
  switch (panel) {
    case 'settings':
      return <IconSettings className={className} />;
    case 'themes':
      return <IconPalette className={className} />;
    case 'plugins':
      return <IconPuzzle className={className} />;
    case 'shortcuts':
      return <IconKeyboard className={className} />;
    case 'whatsnew':
      return <IconSparkle className={className} />;
    case 'about':
    default:
      return <IconInfo className={className} />;
  }
}
