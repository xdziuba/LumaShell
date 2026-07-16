/**
 * Panel ustawień terminala (Etap 1).
 *
 * Ładowany leniwie przez `React.lazy` — nie wchodzi do bundle'a startowego i nie
 * obciąża uruchomienia aplikacji (docs/architecture/05-wydajnosc.md).
 */

import { useMemo } from 'react';
import { detectInstalledFonts } from './font-detection';
import { SETTINGS_LIMITS, type TerminalSettings } from '@shared/types/settings';

interface SettingsPanelProps {
  settings: TerminalSettings;
  onChange: (settings: TerminalSettings) => void;
  onClose: () => void;
}

export default function SettingsPanel({
  settings,
  onChange,
  onClose
}: SettingsPanelProps): React.JSX.Element {
  // Pomiar czcionek dotyka DOM, więc liczony raz na otwarcie panelu.
  const fonts = useMemo(detectInstalledFonts, []);

  const set = <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]): void =>
    onChange({ ...settings, [key]: value });

  return (
    <aside className="settings">
      <header className="settings__header">
        <span className="settings__title">USTAWIENIA</span>
        <button className="settings__close" onClick={onClose} aria-label="Zamknij ustawienia">
          ✕
        </button>
      </header>

      <label className="settings__row">
        <span>Czcionka</span>
        <select
          value={settings.fontFamily}
          onChange={(event) => set('fontFamily', event.target.value)}
        >
          {/* Zapisana czcionka mogła zostać odinstalowana — pokazujemy ją mimo to,
              żeby wybór nie przeskoczył po cichu na inną. */}
          {!fonts.includes(settings.fontFamily) && (
            <option value={settings.fontFamily}>{settings.fontFamily} (niedostępna)</option>
          )}
          {fonts.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </label>

      <label className="settings__row">
        <span>
          Rozmiar <em>{settings.fontSize} px</em>
        </span>
        <input
          type="range"
          min={SETTINGS_LIMITS.fontSize.min}
          max={SETTINGS_LIMITS.fontSize.max}
          value={settings.fontSize}
          onChange={(event) => set('fontSize', Number(event.target.value))}
        />
      </label>

      <label className="settings__row">
        <span>
          Odstęp linii <em>{settings.lineHeight.toFixed(2)}</em>
        </span>
        <input
          type="range"
          min={SETTINGS_LIMITS.lineHeight.min}
          max={SETTINGS_LIMITS.lineHeight.max}
          step={0.05}
          value={settings.lineHeight}
          onChange={(event) => set('lineHeight', Number(event.target.value))}
        />
      </label>

      <label className="settings__row">
        <span>
          Odstęp znaków <em>{settings.letterSpacing} px</em>
        </span>
        <input
          type="range"
          min={SETTINGS_LIMITS.letterSpacing.min}
          max={SETTINGS_LIMITS.letterSpacing.max}
          step={0.5}
          value={settings.letterSpacing}
          onChange={(event) => set('letterSpacing', Number(event.target.value))}
        />
      </label>

      <label className="settings__row settings__row--inline">
        <input
          type="checkbox"
          checked={settings.cursorBlink}
          onChange={(event) => set('cursorBlink', event.target.checked)}
        />
        <span>Migający kursor</span>
      </label>

      <label className="settings__row">
        <span>
          Historia <em>{settings.scrollback.toLocaleString('pl')} linii</em>
        </span>
        <input
          type="range"
          min={0}
          max={50_000}
          step={1000}
          value={Math.min(settings.scrollback, 50_000)}
          onChange={(event) => set('scrollback', Number(event.target.value))}
        />
      </label>

      <p className="settings__hint">Zmiany zapisują się od razu i przeżywają restart.</p>
    </aside>
  );
}
