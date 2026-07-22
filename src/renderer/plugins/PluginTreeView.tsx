/**
 * Widok drzewa dostarczonego przez wtyczkę (Plugin API v2).
 *
 * Wtyczka NIE rysuje tu niczego — przysyła same dane (etykieta, opis, czy da się rozwinąć),
 * a rysuje je aplikacja, w swoim motywie i ze swoją nawigacją klawiaturą. Dzięki temu widok
 * wtyczki nie może udawać czegoś innego niż jest, a autor wtyczki nie pisze ani linii CSS.
 *
 * Dzieci wczytujemy LENIWIE — dopiero przy rozwinięciu węzła. Drzewo katalogów potrafi mieć
 * dziesiątki tysięcy pozycji i budowanie go z góry byłoby bez sensu.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginTreeNode, PluginView } from '@shared/types/ipc';

/** Węzeł spłaszczony do renderu: wiemy, na jakiej jest głębokości i czy rozwinięty. */
interface Wiersz {
  node: PluginTreeNode;
  poziom: number;
  klucz: string;
}

export default function PluginTreeView({ view, onClose }: { view: PluginView; onClose: () => void }): React.JSX.Element {
  const [korzen, setKorzen] = useState<PluginTreeNode[] | null>(null);
  const [dzieci, setDzieci] = useState<Map<string, PluginTreeNode[]>>(new Map());
  const [rozwiniete, setRozwiniete] = useState<Set<string>>(new Set());
  const [wczytywane, setWczytywane] = useState<Set<string>>(new Set());
  const [zaznaczony, setZaznaczony] = useState<string | null>(null);
  const [blad, setBlad] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const pobierz = useCallback(
    async (nodeId: string | null): Promise<PluginTreeNode[]> => {
      try {
        return await window.luma.plugins.viewChildren(view.pluginId, view.id, nodeId);
      } catch (e) {
        setBlad(e instanceof Error ? e.message : String(e));
        return [];
      }
    },
    [view.pluginId, view.id]
  );

  const przeladuj = useCallback(async (): Promise<void> => {
    setBlad(null);
    setDzieci(new Map());
    setRozwiniete(new Set());
    setKorzen(await pobierz(null));
  }, [pobierz]);

  useEffect(() => {
    void przeladuj();
  }, [przeladuj]);

  // Wtyczka może powiedzieć „dane się zmieniły" — wtedy wczytujemy widok od nowa.
  useEffect(() => {
    return window.luma.plugins.onViewRefresh((event) => {
      if (event.pluginId === view.pluginId && event.viewId === view.id) void przeladuj();
    });
  }, [view.pluginId, view.id, przeladuj]);

  const przelacz = async (node: PluginTreeNode): Promise<void> => {
    if (!node.expandable) return;
    const otwarty = rozwiniete.has(node.id);
    if (otwarty) {
      setRozwiniete((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
      return;
    }
    if (!dzieci.has(node.id)) {
      setWczytywane((prev) => new Set(prev).add(node.id));
      const lista = await pobierz(node.id);
      setDzieci((prev) => new Map(prev).set(node.id, lista));
      setWczytywane((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
    setRozwiniete((prev) => new Set(prev).add(node.id));
  };

  const uruchom = (node: PluginTreeNode): void => {
    if (node.command) window.luma.plugins.runNodeCommand(view.pluginId, node.command, node.id);
  };

  /** Spłaszczenie drzewa do listy wierszy — render jest wtedy zwykłą listą. */
  const wiersze: Wiersz[] = [];
  const dodaj = (lista: PluginTreeNode[], poziom: number): void => {
    for (const node of lista) {
      wiersze.push({ node, poziom, klucz: `${poziom}:${node.id}` });
      if (rozwiniete.has(node.id)) dodaj(dzieci.get(node.id) ?? [], poziom + 1);
    }
  };
  dodaj(korzen ?? [], 0);

  const naKlawisz = (event: React.KeyboardEvent): void => {
    if (wiersze.length === 0) return;
    const i = wiersze.findIndex((w) => w.node.id === zaznaczony);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setZaznaczony(wiersze[Math.min(i + 1, wiersze.length - 1)]?.node.id ?? null);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setZaznaczony(wiersze[Math.max(i - 1, 0)]?.node.id ?? null);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const node = wiersze[i]?.node;
      if (node?.expandable) void przelacz(node);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const node = wiersze[i]?.node;
      if (!node) return;
      if (node.expandable) void przelacz(node);
      else uruchom(node);
    } else if (event.key === 'F5') {
      event.preventDefault();
      void przeladuj();
    }
  };

  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">{view.title.toUpperCase()}</span>
        <div className="panel__header-actions">
          <span className="plugins__badge" title={`Widok wtyczki ${view.pluginName}`}>
            {view.pluginName}
          </span>
          <button className="panel__link" onClick={() => void przeladuj()} title="Odśwież (F5)">
            Odśwież
          </button>
        </div>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body ptree" tabIndex={0} onKeyDown={naKlawisz} ref={listaRef}>
        {blad && <div className="sftp__error">{blad}</div>}
        {korzen === null && <div className="panel__hint">wczytywanie…</div>}
        {korzen?.length === 0 && !blad && <div className="panel__hint">Widok jest pusty.</div>}

        {wiersze.map(({ node, poziom, klucz }) => (
          <div
            key={klucz}
            className={`ptree__row${zaznaczony === node.id ? ' is-selected' : ''}`}
            style={{ paddingLeft: `${8 + poziom * 16}px` }}
            onClick={() => {
              setZaznaczony(node.id);
              if (node.expandable) void przelacz(node);
            }}
            // Dwuklik uruchamia komendę węzła NIEZALEŻNIE od tego, czy da się go rozwinąć:
            // katalog też może mieć akcję (np. „otwórz tu terminal"), a pojedynczy klik
            // zostaje od rozwijania.
            onDoubleClick={() => uruchom(node)}
            title={node.description ?? node.label}
          >
            <span className="ptree__arrow">
              {node.expandable ? (wczytywane.has(node.id) ? '·' : rozwiniete.has(node.id) ? '▾' : '▸') : ''}
            </span>
            <span className="ptree__label">{node.label}</span>
            {node.description && <span className="ptree__desc">{node.description}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
