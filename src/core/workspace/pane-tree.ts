/**
 * Drzewo paneli w zakładce (Etap 2 — podziały).
 *
 * Zakładka trzyma binarne drzewo podziałów: liść to jedna sesja terminala, węzeł split
 * dzieli obszar na dwoje w pionie albo poziomie. Dowolne zagnieżdżenie daje dowolny układ.
 *
 * Ten plik należy do `core` — czysta logika bez DOM ani IPC, w pełni testowalna jednostkowo
 * (docs/architecture/06-struktura-projektu.md). Operacje są niemutujące: zwracają nowe
 * drzewo, nie zmieniają wejścia.
 */

import type { MonitorMode, SessionSpec } from '@shared/types/ipc';

export type PaneStatus = 'starting' | 'running' | 'closed' | 'error';
export type SplitDirection = 'row' | 'column';

export interface LeafPane {
  kind: 'leaf';
  id: string;
  spec: SessionSpec;
  label: string;
  status: PaneStatus;
  detail?: string;
  /** Identyfikator sesji z procesu głównego — ustawiany po zestawieniu (do SFTP itp.). */
  sessionId?: string;
  /** Tryb monitora (port szeregowy): hex / znaczniki czasu. */
  monitor?: MonitorMode;
}

export interface SplitPane {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  /** Udział pierwszego dziecka (0..1); drugie dostaje resztę. */
  ratio: number;
  a: Pane;
  b: Pane;
}

export type Pane = LeafPane | SplitPane;

/** Wszystkie liście w kolejności od lewej/góry. */
export function leaves(node: Pane): LeafPane[] {
  return node.kind === 'leaf' ? [node] : [...leaves(node.a), ...leaves(node.b)];
}

export function findLeaf(node: Pane, id: string): LeafPane | undefined {
  return leaves(node).find((leaf) => leaf.id === id);
}

/**
 * Zastępuje wskazany liść podziałem: stary liść trafia jako pierwszy, nowy jako drugi.
 * `makeLeaf` tworzy nowy liść (z własnym id) — dzięki temu core nie zależy od generatora id.
 */
export function splitLeaf(
  node: Pane,
  targetId: string,
  direction: SplitDirection,
  splitId: string,
  makeLeaf: () => LeafPane
): Pane {
  if (node.kind === 'leaf') {
    if (node.id !== targetId) return node;
    return { kind: 'split', id: splitId, direction, ratio: 0.5, a: node, b: makeLeaf() };
  }
  return {
    ...node,
    a: splitLeaf(node.a, targetId, direction, splitId, makeLeaf),
    b: splitLeaf(node.b, targetId, direction, splitId, makeLeaf)
  };
}

/**
 * Usuwa liść i zwija drzewo: gdy jedno dziecko splitu znika, jego rodzeństwo zajmuje
 * miejsce splitu. Zwraca `null`, gdy usunięto ostatni liść — wołający zamyka wtedy zakładkę.
 */
export function closeLeaf(node: Pane, targetId: string): Pane | null {
  if (node.kind === 'leaf') return node.id === targetId ? null : node;
  const a = closeLeaf(node.a, targetId);
  const b = closeLeaf(node.b, targetId);
  if (a && b) return { ...node, a, b };
  return a ?? b; // jedno dziecko przepadło — drugie zastępuje split
}

export function updateLeaf(node: Pane, id: string, patch: Partial<Omit<LeafPane, 'id' | 'kind'>>): Pane {
  if (node.kind === 'leaf') return node.id === id ? { ...node, ...patch } : node;
  return { ...node, a: updateLeaf(node.a, id, patch), b: updateLeaf(node.b, id, patch) };
}

/** Ustawia udział podziału o danym id, przycięty do rozsądnego zakresu. */
export function setRatio(node: Pane, splitId: string, ratio: number): Pane {
  if (node.kind === 'leaf') return node;
  if (node.id === splitId) {
    return { ...node, ratio: Math.min(0.9, Math.max(0.1, ratio)) };
  }
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) };
}

/**
 * Przycina drzewo do liści przechodzących predykat, zwijając osierocone podziały.
 *
 * Używane przy przywracaniu sesji: zostają tylko sesje powłok, bo portów szeregowych nie
 * wolno auto-otwierać (docs/security/03-polityka-agenta.md). `null` = całe drzewo odpadło.
 */
export function pruneLeaves(node: Pane, keep: (leaf: LeafPane) => boolean): Pane | null {
  if (node.kind === 'leaf') return keep(node) ? node : null;
  const a = pruneLeaves(node.a, keep);
  const b = pruneLeaves(node.b, keep);
  if (a && b) return { ...node, a, b };
  return a ?? b;
}
