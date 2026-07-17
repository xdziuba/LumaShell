/**
 * Testy jednostkowe drzewa paneli (czysta logika, bez DOM).
 *
 * Uruchomienie: node --experimental-transform-types tests/unit/pane-tree.test.ts
 */

import {
  closeLeaf,
  findLeaf,
  leaves,
  pruneLeaves,
  setRatio,
  splitLeaf,
  updateLeaf,
  type LeafPane,
  type Pane
} from '../../src/core/workspace/pane-tree.ts';

let n = 0;
const leaf = (kind: 'pty' | 'serial' = 'pty'): LeafPane => ({
  kind: 'leaf',
  id: `L${++n}`,
  spec: kind === 'pty' ? { kind: 'pty' } : { kind: 'serial', path: 'COM1', baudRate: 9600 },
  label: `leaf-${n}`,
  status: 'running'
});

const wyniki: Array<{ nazwa: string; ok: boolean }> = [];
const sprawdz = (nazwa: string, ok: boolean): void => {
  wyniki.push({ nazwa, ok });
};

// splitLeaf zamienia liść na split z dwoma liśćmi.
{
  const root: Pane = leaf();
  const split = splitLeaf(root, root.id, 'row', 'S1', () => leaf());
  sprawdz('split tworzy węzeł z 2 liśćmi', split.kind === 'split' && leaves(split).length === 2);
  sprawdz('split zachowuje stary liść jako pierwszy', split.kind === 'split' && split.a === root);
  sprawdz('wejście nie zmutowane', root.kind === 'leaf');
}

// Zagnieżdżony split: 3 liście po dwóch podziałach.
{
  const a = leaf();
  let tree: Pane = splitLeaf(a, a.id, 'row', 'S1', () => leaf());
  const target = leaves(tree)[1]!;
  tree = splitLeaf(tree, target.id, 'column', 'S2', () => leaf());
  sprawdz('podwójny split → 3 liście', leaves(tree).length === 3);
}

// closeLeaf zwija split — rodzeństwo zajmuje miejsce.
{
  const a = leaf();
  const tree = splitLeaf(a, a.id, 'row', 'S1', () => leaf());
  const drugi = leaves(tree)[1]!;
  const po = closeLeaf(tree, drugi.id);
  sprawdz('zamknięcie liścia zwija split do rodzeństwa', po?.kind === 'leaf' && po.id === a.id);
}

// closeLeaf ostatniego liścia zwraca null.
{
  const only = leaf();
  sprawdz('zamknięcie ostatniego liścia → null', closeLeaf(only, only.id) === null);
}

// closeLeaf w głębszym drzewie zwija tylko właściwy poziom.
{
  const a = leaf();
  let tree: Pane = splitLeaf(a, a.id, 'row', 'S1', () => leaf());
  const mid = leaves(tree)[1]!;
  tree = splitLeaf(tree, mid.id, 'column', 'S2', () => leaf());
  // teraz: S1(a, S2(mid, x)); zamknięcie mid ma zwinąć S2 do x, S1 zostaje
  const x = leaves(tree)[2]!;
  const po = closeLeaf(tree, mid.id);
  sprawdz('głęboki kolaps zachowuje resztę drzewa', po?.kind === 'split' && leaves(po).length === 2);
  sprawdz('głęboki kolaps podmienia właściwe dziecko', po?.kind === 'split' && po.b.kind === 'leaf' && po.b.id === x.id);
}

// updateLeaf zmienia tylko wskazany liść.
{
  const a = leaf();
  const tree = splitLeaf(a, a.id, 'row', 'S1', () => leaf());
  const po = updateLeaf(tree, a.id, { status: 'closed', detail: 'koniec' });
  sprawdz('update zmienia właściwy liść', findLeaf(po, a.id)?.status === 'closed');
  sprawdz('update nie rusza rodzeństwa', findLeaf(po, leaves(tree)[1]!.id)?.status === 'running');
}

// setRatio przycina do zakresu.
{
  const a = leaf();
  const tree = splitLeaf(a, a.id, 'row', 'S1', () => leaf());
  const po = setRatio(tree, 'S1', 5);
  sprawdz('setRatio przycina do max 0.9', po.kind === 'split' && po.ratio === 0.9);
}

// pruneLeaves usuwa serial i zwija.
{
  const a = leaf('pty');
  let tree: Pane = splitLeaf(a, a.id, 'row', 'S1', () => leaf('serial'));
  const pruned = pruneLeaves(tree, (l) => l.spec.kind === 'pty');
  sprawdz('prune usuwa serial i zwija do pty', pruned?.kind === 'leaf' && pruned.id === a.id);

  const wszystkieSerial = leaf('serial');
  sprawdz('prune samego serial → null', pruneLeaves(wszystkieSerial, (l) => l.spec.kind === 'pty') === null);
}

console.log('WYNIKI (drzewo paneli)');
console.log('─'.repeat(52));
for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.nazwa}`);
console.log('─'.repeat(52));
const bledy = wyniki.filter((w) => !w.ok).length;
console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
process.exit(bledy === 0 ? 0 : 1);
