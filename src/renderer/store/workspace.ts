/**
 * Stan workspace'u: zakładki i aktywna sesja (Etap 2).
 *
 * Zakładka opisuje **czym sesja ma być**; samą sesją zarządza `TerminalView`, który
 * zgłasza tu etykietę i stan. Podział jest celowy: store nie wie nic o PTY ani o IPC.
 */

import { create } from 'zustand';
import type { SessionSpec } from '@shared/types/ipc';

export type TabStatus = 'starting' | 'running' | 'closed' | 'error';

export interface Tab {
  id: string;
  spec: SessionSpec;
  label: string;
  status: TabStatus;
  /** Powód błędu albo informacja o zakończeniu — pokazywana na pasku statusu. */
  detail?: string;
}

/** Identyfikatory są lokalne dla okna, więc licznik wystarcza — bez UUID. */
let nextId = 1;

interface WorkspaceState {
  tabs: Tab[];
  activeId: string | null;
  open: (spec: SessionSpec, label: string) => string;
  close: (id: string) => void;
  activate: (id: string) => void;
  update: (id: string, patch: Partial<Omit<Tab, 'id'>>) => void;
  /** Odtworzenie zakładek z zapisanego układu — jednym krokiem, bez migotania. */
  restore: (entries: Array<{ spec: SessionSpec; label: string }>, activeIndex: number) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  tabs: [],
  activeId: null,

  open: (spec, label) => {
    const id = `tab-${nextId++}`;
    set((state) => ({
      tabs: [...state.tabs, { id, spec, label, status: 'starting' }],
      activeId: id
    }));
    return id;
  },

  close: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return state;

      const tabs = state.tabs.filter((tab) => tab.id !== id);
      if (state.activeId !== id) return { tabs, activeId: state.activeId };

      // Zamknięcie aktywnej zakładki przenosi uwagę na sąsiada z prawej, a gdy go nie
      // ma — z lewej. Tak zachowuje się każdy terminal i przeglądarka.
      const next = tabs[index] ?? tabs[index - 1];
      return { tabs, activeId: next?.id ?? null };
    }),

  activate: (id) => set({ activeId: id }),

  update: (id, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
    })),

  restore: (entries, activeIndex) =>
    set(() => {
      const tabs: Tab[] = entries.map((entry) => ({
        id: `tab-${nextId++}`,
        spec: entry.spec,
        label: entry.label,
        status: 'starting'
      }));
      const active = tabs[Math.min(activeIndex, tabs.length - 1)] ?? null;
      return { tabs, activeId: active?.id ?? null };
    })
}));
