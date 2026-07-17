/**
 * Pasek zakładek (Etap 2).
 *
 * Sam pasek nic nie wie o drzewie paneli — dostaje gotową etykietę i status z aktywnego
 * panelu każdej zakładki i zgłasza intencje.
 */

import type { TabStatus } from '../store/workspace';

/** Kropka statusu zamiast tekstu: pasek musi zostać czytelny przy wielu zakładkach. */
const STATUS_TITLE: Record<TabStatus, string> = {
  starting: 'uruchamianie',
  running: 'działa',
  closed: 'zakończona',
  error: 'błąd'
};

export interface TabView {
  id: string;
  label: string;
  status: TabStatus;
  /** Ile paneli ma zakładka — pokazujemy licznik przy podziale. */
  paneCount: number;
}

interface TabBarProps {
  tabs: TabView[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps): React.JSX.Element {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tabs__item${tab.id === activeId ? ' is-active' : ''}`}
          onClick={() => onSelect(tab.id)}
          // Środkowy przycisk zamyka zakładkę — odruch z każdej przeglądarki.
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose(tab.id);
            }
          }}
          title={`${tab.label} — ${STATUS_TITLE[tab.status]}`}
        >
          <span className={`tabs__dot tabs__dot--${tab.status}`} />
          <span className="tabs__label">{tab.label}</span>
          {tab.paneCount > 1 && <span className="tabs__count">{tab.paneCount}</span>}
          <button
            className="tabs__close"
            onClick={(event) => {
              // Bez tego kliknięcie w „×" najpierw aktywowałoby zamykaną zakładkę.
              event.stopPropagation();
              onClose(tab.id);
            }}
            aria-label={`Zamknij ${tab.label}`}
          >
            ✕
          </button>
        </div>
      ))}

      <button className="tabs__new" onClick={onNew} aria-label="Nowa zakładka" title="Nowa zakładka">
        +
      </button>
    </div>
  );
}
