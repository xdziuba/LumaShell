/**
 * Panel skrótów klawiszowych i krótkiej pomocy (Etap UI) — otwierany jako zakładka.
 *
 * Lista odpowiada rzeczywistym skrótom z hooka useShortcuts i obsłudze terminala; przy
 * zmianach skrótów trzeba ją zaktualizować (nie jest generowana automatycznie).
 */

interface Group {
  title: string;
  items: Array<{ keys: string[]; desc: string }>;
}

const GROUPS: Group[] = [
  {
    title: 'Zakładki i panele',
    items: [
      { keys: ['Ctrl', 'T'], desc: 'Nowa zakładka' },
      { keys: ['Ctrl', 'W'], desc: 'Zamknij aktywny panel / zakładkę' },
      { keys: ['Ctrl', 'Tab'], desc: 'Następna zakładka' },
      { keys: ['Ctrl', 'Shift', 'Tab'], desc: 'Poprzednia zakładka' },
      { keys: ['Ctrl', '1'], desc: 'Przełącz na zakładkę 1–9 (Ctrl+9 = ostatnia)' },
      { keys: ['Ctrl', 'Shift', 'E'], desc: 'Podziel panel w pionie' },
      { keys: ['Ctrl', 'Shift', 'O'], desc: 'Podziel panel w poziomie' }
    ]
  },
  {
    title: 'Nawigacja i akcje',
    items: [
      { keys: ['Ctrl', 'Shift', 'P'], desc: 'Paleta komend' },
      { keys: ['Ctrl', ','], desc: 'Ustawienia' }
    ]
  },
  {
    title: 'Terminal',
    items: [
      { keys: ['Ctrl', 'Shift', 'C'], desc: 'Kopiuj zaznaczenie' },
      { keys: ['Ctrl', 'Shift', 'V'], desc: 'Wklej' },
      { keys: ['Ctrl', 'C'], desc: 'Kopiuj (gdy jest zaznaczenie) lub przerwij proces' },
      { keys: ['PPM'], desc: 'Kopiuj zaznaczenie albo wklej (jak w konsoli Windows)' }
    ]
  }
];

export default function ShortcutsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">SKRÓTY KLAWISZOWE</span>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body">
        {GROUPS.map((group) => (
          <section key={group.title} className="shortcuts__group">
            <h3 className="shortcuts__heading">{group.title}</h3>
            {group.items.map((item) => (
              <div key={item.desc} className="shortcuts__row">
                <span className="shortcuts__keys">
                  {item.keys.map((k) => (
                    <kbd key={k} className="shortcuts__kbd">
                      {k}
                    </kbd>
                  ))}
                </span>
                <span className="shortcuts__desc">{item.desc}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
