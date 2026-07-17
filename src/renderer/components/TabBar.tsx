/**
 * Pasek zakładek (Etap 2).
 *
 * Sam pasek nic nie wie o drzewie paneli — dostaje gotową etykietę i status z aktywnego
 * panelu każdej zakładki i zgłasza intencje.
 */

import { useState } from 'react';
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
  /** Upuszczenie przeciąganej zakładki przed albo za wskazaną. */
  onReorder: (draggedId: string, targetId: string, before: boolean) => void;
}

/** Gdzie wypadnie upuszczenie względem zakładki, na którą najeżdża kursor. */
interface DropMark {
  targetId: string;
  before: boolean;
}

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onReorder
}: TabBarProps): React.JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);

  const onDragOver = (event: React.DragEvent, targetId: string): void => {
    if (!dragId || dragId === targetId) return;
    event.preventDefault(); // zezwala na drop
    // Lewa połowa zakładki = wstaw przed, prawa = za.
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    setMark({ targetId, before });
  };

  const onDrop = (): void => {
    if (dragId && mark) onReorder(dragId, mark.targetId, mark.before);
    setDragId(null);
    setMark(null);
  };

  return (
    <div className="tabs">
      {tabs.map((tab) => {
        const markedBefore = mark?.targetId === tab.id && mark.before;
        const markedAfter = mark?.targetId === tab.id && !mark.before;
        return (
          <div
            key={tab.id}
            className={
              `tabs__item${tab.id === activeId ? ' is-active' : ''}` +
              `${tab.id === dragId ? ' is-dragging' : ''}` +
              `${markedBefore ? ' drop-before' : ''}${markedAfter ? ' drop-after' : ''}`
            }
            draggable
            onDragStart={() => setDragId(tab.id)}
            onDragEnd={() => {
              setDragId(null);
              setMark(null);
            }}
            onDragOver={(event) => onDragOver(event, tab.id)}
            onDrop={onDrop}
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
        );
      })}

      <button className="tabs__new" onClick={onNew} aria-label="Nowa zakładka" title="Nowa zakładka">
        +
      </button>
    </div>
  );
}
