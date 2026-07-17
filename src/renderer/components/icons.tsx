/**
 * Zestaw ikon SVG (Etap UI).
 *
 * Ikony liniowe w stylu Lucide: 16×16, `currentColor`, stroke 1.5 — dziedziczą kolor po
 * tekście, więc reagują na stan (hover, status). Zgodnie z wytycznymi: ikony jako SVG, nigdy
 * emoji (docs — ui-ux-pro-max: no emoji as icons).
 */

import type { SessionSpec } from '@shared/types/ipc';

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
