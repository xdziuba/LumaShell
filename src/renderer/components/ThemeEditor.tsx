/**
 * Edytor motywów (Etap 5).
 *
 * Startuje od aktywnego motywu, pozwala zmienić kolory i promień zaokrągleń z podglądem
 * na żywo, zapisać jako własny motyw, zaimportować/wyeksportować plik i usunąć własny.
 * Ładowany leniwie (docs/architecture/05-wydajnosc.md).
 */

import { useState } from 'react';
import { BUILT_IN_THEMES, type Theme } from '@core/theme/theme';

interface ThemeEditorProps {
  base: Theme;
  onPreview: (theme: Theme) => void;
  onSave: (theme: Theme) => void;
  onImport: () => void;
  onExport: (theme: Theme) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** id z nazwy: małe litery, myślniki. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'motyw';
}

const COLOR_FIELDS: Array<{ key: keyof Theme['colors']; label: string }> = [
  { key: 'accent', label: 'Akcent' },
  { key: 'accentDark', label: 'Akcent ciemny' },
  { key: 'accentNeon', label: 'Akcent neon' },
  { key: 'bgBase', label: 'Tło główne' },
  { key: 'bgPanel', label: 'Tło paneli' },
  { key: 'text', label: 'Tekst' },
  { key: 'textMuted', label: 'Tekst drugorzędny' },
  { key: 'border', label: 'Obramowanie' }
];

const TERM_FIELDS: Array<{ key: keyof Theme['terminal']; label: string }> = [
  { key: 'background', label: 'Tło terminala' },
  { key: 'foreground', label: 'Tekst terminala' },
  { key: 'cursor', label: 'Kursor' },
  { key: 'selection', label: 'Zaznaczenie' }
];

export default function ThemeEditor({
  base,
  onPreview,
  onSave,
  onImport,
  onExport,
  onDelete,
  onClose
}: ThemeEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<Theme>(base);
  const isBuiltIn = BUILT_IN_THEMES.some((t) => t.id === draft.id);

  const update = (next: Theme): void => {
    setDraft(next);
    onPreview(next); // podgląd na żywo
  };

  const setColor = (key: keyof Theme['colors'], value: string): void =>
    update({ ...draft, colors: { ...draft.colors, [key]: value } });
  const setTerm = (key: keyof Theme['terminal'], value: string): void =>
    update({ ...draft, terminal: { ...draft.terminal, [key]: value } });

  const pickWallpaper = (): void => {
    void window.luma.themes.pickWallpaper().then((dataUrl) => {
      if (dataUrl) update({ ...draft, wallpaper: { dataUrl, dim: draft.wallpaper?.dim ?? 0.5 } });
    });
  };
  const clearWallpaper = (): void => {
    const { wallpaper: _drop, ...rest } = draft;
    update(rest);
  };

  const save = (): void => {
    // Zmiana wbudowanego tworzy nowy motyw własny (wbudowanych nie nadpisujemy).
    const id = isBuiltIn ? slugify(draft.name) + '-custom' : draft.id;
    onSave({ ...draft, id });
  };

  // `<input type=color>` przyjmuje tylko #rrggbb — dla rgba/nazw pokazujemy pole tekstowe.
  const isHex = (v: string): boolean => /^#[0-9a-fA-F]{6}$/.test(v);

  return (
    <aside className="settings">
      <header className="settings__header">
        <span className="settings__title">EDYTOR MOTYWU</span>
        <button className="settings__close" onClick={onClose} aria-label="Zamknij edytor">
          ✕
        </button>
      </header>

      <label className="settings__row">
        <span>Nazwa</span>
        <input value={draft.name} onChange={(e) => update({ ...draft, name: e.target.value })} />
      </label>

      {[...COLOR_FIELDS.map((f) => ({ ...f, group: 'colors' as const })),
        ...TERM_FIELDS.map((f) => ({ ...f, group: 'terminal' as const }))].map((f) => {
        const value = f.group === 'colors' ? draft.colors[f.key as keyof Theme['colors']] : draft.terminal[f.key as keyof Theme['terminal']];
        const set = (v: string): void =>
          f.group === 'colors' ? setColor(f.key as keyof Theme['colors'], v) : setTerm(f.key as keyof Theme['terminal'], v);
        return (
          <label className="settings__row theme-row" key={`${f.group}.${String(f.key)}`}>
            <span>{f.label}</span>
            {isHex(value) && (
              <input type="color" value={value} onChange={(e) => set(e.target.value)} className="theme-swatch" />
            )}
            <input value={value} onChange={(e) => set(e.target.value)} className="theme-color-text" />
          </label>
        );
      })}

      <label className="settings__row">
        <span>
          Zaokrąglenie <em>{draft.effects.borderRadius}px</em>
        </span>
        <input
          type="range"
          min={0}
          max={24}
          value={draft.effects.borderRadius}
          onChange={(e) => update({ ...draft, effects: { ...draft.effects, borderRadius: Number(e.target.value) } })}
        />
      </label>
      <label className="settings__row">
        <span>
          Rozmycie szkła <em>{draft.effects.blur}px</em>
        </span>
        <input
          type="range"
          min={0}
          max={40}
          value={draft.effects.blur}
          onChange={(e) => update({ ...draft, effects: { ...draft.effects, blur: Number(e.target.value) } })}
        />
      </label>
      <label className="settings__row">
        <span>
          Przezroczystość <em>{Math.round(draft.effects.opacity * 100)}%</em>
        </span>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={draft.effects.opacity}
          onChange={(e) => update({ ...draft, effects: { ...draft.effects, opacity: Number(e.target.value) } })}
        />
      </label>
      <label className="settings__row">
        <span>
          Kąt gradientu <em>{draft.effects.gradientAngle}°</em>
        </span>
        <input
          type="range"
          min={0}
          max={360}
          value={draft.effects.gradientAngle}
          onChange={(e) => update({ ...draft, effects: { ...draft.effects, gradientAngle: Number(e.target.value) } })}
        />
      </label>

      <div className="settings__row settings__row--inline theme-wallpaper">
        <span>Tapeta terminala</span>
        <button type="button" className="dialog__button" onClick={pickWallpaper}>
          {draft.wallpaper ? 'Zmień' : 'Wybierz'}
        </button>
        {draft.wallpaper && (
          <button type="button" className="dialog__button dialog__button--danger" onClick={clearWallpaper}>
            Usuń
          </button>
        )}
      </div>
      {draft.wallpaper && (
        <label className="settings__row">
          <span>
            Przyciemnienie <em>{Math.round(draft.wallpaper.dim * 100)}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.05}
            value={draft.wallpaper.dim}
            onChange={(e) =>
              update({ ...draft, wallpaper: { ...draft.wallpaper!, dim: Number(e.target.value) } })
            }
          />
        </label>
      )}

      <div className="theme-actions">
        <button className="dialog__button dialog__button--primary" onClick={save}>
          {isBuiltIn ? 'Zapisz jako własny' : 'Zapisz'}
        </button>
        <button className="dialog__button" onClick={() => onExport(draft)}>
          Eksport
        </button>
        <button className="dialog__button" onClick={onImport}>
          Import
        </button>
        {/* Motyw można też po prostu wrzucić jako plik .json do katalogu motywów —
            po ponownym otwarciu panelu jest na liście. */}
        <button
          className="dialog__button"
          onClick={() => window.luma.paths.open('themes')}
          title="Katalog na własne motywy (pliki .json)"
        >
          Katalog motywów
        </button>
        {!isBuiltIn && (
          <button className="dialog__button dialog__button--danger" onClick={() => onDelete(draft.id)}>
            Usuń
          </button>
        )}
      </div>
    </aside>
  );
}
