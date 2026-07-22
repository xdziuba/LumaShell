/**
 * Stan workspace'u: zakładki (Etap 2 — podziały; polish UI — panele jako zakładki).
 *
 * Zakładka jest albo SESJĄ (drzewo paneli terminala), albo PANELEM (Ustawienia/About/…),
 * który zastępuje terminal, gdy jest aktywny. Struktura drzewa i jej przekształcenia
 * mieszkają w `core/workspace/pane-tree` — czyste, przetestowane jednostkowo.
 */

import { create } from 'zustand';
import {
  closeLeaf,
  leaves,
  setRatio,
  splitLeaf,
  updateLeaf,
  type LeafPane,
  type Pane,
  type PaneStatus,
  type SplitDirection
} from '@core/workspace/pane-tree';
import type { SessionSpec, StoredPane, WorkspaceTab } from '@shared/types/ipc';
import type { PanelKind } from '../panels/kinds';

export type TabStatus = PaneStatus;

/** Zakładka-sesja: drzewo paneli terminala. */
export interface SessionTab {
  kind: 'session';
  id: string;
  root: Pane;
  /** Który panel w tej zakładce ma fokus. */
  activePaneId: string;
}

/** Zakładka-panel: widok bez sesji (Ustawienia, About, Wtyczki…). */
export interface PanelTab {
  kind: 'panel';
  id: string;
  panel: PanelKind;
}

/**
 * Zakładka-widok wtyczki (Plugin API v2). Treść dostarcza wtyczka jako DANE, rysuje ją
 * aplikacja — dlatego wystarczy tu wskazać, czyj to widok.
 */
export interface PluginTab {
  kind: 'plugin';
  id: string;
  pluginId: string;
  viewId: string;
  title: string;
}

export type Tab = SessionTab | PanelTab | PluginTab;

/** Identyfikatory lokalne dla okna — licznik wystarcza, bez UUID. */
let nextId = 1;
const genId = (prefix: string): string => `${prefix}-${nextId++}`;

function makeLeaf(spec: SessionSpec, label: string): LeafPane {
  return { kind: 'leaf', id: genId('pane'), spec, label, status: 'starting' };
}

/** Runtime'owe drzewo → forma zapisu (bez id i statusu — te powstają na nowo przy odtworzeniu). */
function toStored(node: Pane): StoredPane {
  return node.kind === 'leaf'
    ? { kind: 'leaf', spec: node.spec, label: node.label }
    : { kind: 'split', direction: node.direction, ratio: node.ratio, a: toStored(node.a), b: toStored(node.b) };
}

/** Forma zapisu → runtime'owe drzewo ze świeżymi id. */
function fromStored(node: StoredPane): Pane {
  return node.kind === 'leaf'
    ? makeLeaf(node.spec, node.label)
    : {
        kind: 'split',
        id: genId('split'),
        direction: node.direction,
        ratio: node.ratio,
        a: fromStored(node.a),
        b: fromStored(node.b)
      };
}

/** Serializacja zakładki-sesji do zapisu: drzewo + indeks aktywnego liścia. */
export function serializeTab(tab: SessionTab): WorkspaceTab {
  const activeLeafIndex = Math.max(
    0,
    leaves(tab.root).findIndex((leaf) => leaf.id === tab.activePaneId)
  );
  return { root: toStored(tab.root), activeLeafIndex };
}

interface WorkspaceState {
  tabs: Tab[];
  activeId: string | null;

  open: (spec: SessionSpec, label: string) => string;
  /** Otwiera panel jako zakładkę; jeśli taki już jest — tylko go aktywuje. */
  openPanel: (panel: PanelKind) => void;
  /** Otwiera widok wtyczki jako zakładkę; drugie otwarcie tylko ją aktywuje. */
  openPluginView: (pluginId: string, viewId: string, title: string) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  restore: (tabs: WorkspaceTab[], activeIndex: number) => void;
  /** Ustawia pełną kolejność zakładek wg listy id (commit przeciągania z podglądem). */
  setTabOrder: (ids: string[]) => void;

  /** Aktualizacja liścia (etykieta, status) — tylko dla zakładek-sesji. */
  updatePane: (tabId: string, paneId: string, patch: Partial<Omit<LeafPane, 'id' | 'kind'>>) => void;
  splitActivePane: (direction: SplitDirection) => void;
  closePane: (tabId: string, paneId: string) => void;
  focusPane: (tabId: string, paneId: string) => void;
  resizeSplit: (tabId: string, splitId: string, ratio: number) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  tabs: [],
  activeId: null,

  open: (spec, label) => {
    const leaf = makeLeaf(spec, label);
    const tab: SessionTab = { kind: 'session', id: genId('tab'), root: leaf, activePaneId: leaf.id };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: tab.id }));
    return tab.id;
  },

  openPanel: (panel) =>
    set((state) => {
      // Panel danego rodzaju istnieje w jednym egzemplarzu — drugie otwarcie tylko aktywuje.
      const existing = state.tabs.find((tab) => tab.kind === 'panel' && tab.panel === panel);
      if (existing) return { activeId: existing.id };
      const tab: PanelTab = { kind: 'panel', id: genId('tab'), panel };
      return { tabs: [...state.tabs, tab], activeId: tab.id };
    }),

  openPluginView: (pluginId, viewId, title) =>
    set((state) => {
      const existing = state.tabs.find(
        (tab) => tab.kind === 'plugin' && tab.pluginId === pluginId && tab.viewId === viewId
      );
      if (existing) return { activeId: existing.id };
      const tab: PluginTab = { kind: 'plugin', id: genId('tab'), pluginId, viewId, title };
      return { tabs: [...state.tabs, tab], activeId: tab.id };
    }),

  closeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      if (state.activeId !== id) return { tabs, activeId: state.activeId };
      const next = tabs[index] ?? tabs[index - 1];
      return { tabs, activeId: next?.id ?? null };
    }),

  activate: (id) => set({ activeId: id }),

  setTabOrder: (ids) =>
    set((state) => {
      const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
      const next = ids.map((id) => byId.get(id)).filter((tab): tab is Tab => Boolean(tab));
      // Bezpiecznik: lista musi być permutacją bieżących zakładek, inaczej nie ruszamy.
      if (next.length !== state.tabs.length) return state;
      return { tabs: next };
    }),

  restore: (stored, activeIndex) =>
    set(() => {
      const tabs: Tab[] = stored.map((entry) => {
        const root = fromStored(entry.root);
        const list = leaves(root);
        const activeLeaf = list[Math.min(entry.activeLeafIndex, list.length - 1)] ?? list[0]!;
        return { kind: 'session', id: genId('tab'), root, activePaneId: activeLeaf.id };
      });
      const active = tabs[Math.min(activeIndex, tabs.length - 1)] ?? null;
      return { tabs, activeId: active?.id ?? null };
    }),

  updatePane: (tabId, paneId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.kind === 'session'
          ? { ...tab, root: updateLeaf(tab.root, paneId, patch) }
          : tab
      )
    })),

  splitActivePane: (direction) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === state.activeId);
      if (!tab || tab.kind !== 'session') return state;
      const source = leaves(tab.root).find((l) => l.id === tab.activePaneId);
      if (!source) return state;

      // Nowy panel duplikuje sesję dzielonego panelu — odruch znany z Windows Terminal.
      const fresh = makeLeaf(source.spec, source.label);
      const root = splitLeaf(tab.root, source.id, direction, genId('split'), () => fresh);
      return {
        tabs: state.tabs.map((t) =>
          t.id === tab.id && t.kind === 'session' ? { ...t, root, activePaneId: fresh.id } : t
        )
      };
    }),

  closePane: (tabId, paneId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab || tab.kind !== 'session') return state;

      const root = closeLeaf(tab.root, paneId);
      if (!root) {
        // Ostatni panel w zakładce — zamknięcie panelu zamyka zakładkę.
        const index = state.tabs.findIndex((t) => t.id === tabId);
        const tabs = state.tabs.filter((t) => t.id !== tabId);
        if (state.activeId !== tabId) return { tabs, activeId: state.activeId };
        const next = tabs[index] ?? tabs[index - 1];
        return { tabs, activeId: next?.id ?? null };
      }

      // Fokus mógł zniknąć wraz z zamkniętym panelem — przejmuje pierwszy pozostały.
      const activePaneId = leaves(root).some((l) => l.id === tab.activePaneId)
        ? tab.activePaneId
        : leaves(root)[0]!.id;
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId && t.kind === 'session' ? { ...t, root, activePaneId } : t
        )
      };
    }),

  focusPane: (tabId, paneId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.kind === 'session' ? { ...t, activePaneId: paneId } : t
      )
    })),

  resizeSplit: (tabId, splitId, ratio) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.kind === 'session' ? { ...t, root: setRatio(t.root, splitId, ratio) } : t
      )
    }))
}));
