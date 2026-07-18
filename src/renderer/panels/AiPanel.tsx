/**
 * Panel Agenta AI (AI-0) — na tym etapie: konfiguracja dostawcy.
 *
 * Wybór dostawcy (OpenAI API / lokalny / własny endpoint), bazowy URL, klucz API i model,
 * z testem połączenia i pobraniem listy modeli. Klucz zapisuje się szyfrowany w procesie
 * głównym (safeStorage) — tu wpisujemy go tylko raz; renderer nie zna jego wartości. Czat i
 * narzędzia agenta dochodzą w kolejnych etapach (AI-1+).
 */

import { useEffect, useState } from 'react';
import type { AiConfig, AiModel } from '@core/ai/provider';
import { ANTHROPIC_DEFAULT_BASE_URL, OPENAI_DEFAULT_BASE_URL } from '@core/ai/provider';

const LOCAL_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/** Domyślny bazowy URL zależny od dostawcy (dla „własnego" zostawiamy, co było). */
const BASE_URL_FOR: Partial<Record<AiConfig['provider'], string>> = {
  openai: OPENAI_DEFAULT_BASE_URL,
  anthropic: ANTHROPIC_DEFAULT_BASE_URL,
  local: LOCAL_DEFAULT_BASE_URL
};

type Status = { kind: 'idle' | 'ok' | 'err' | 'busy'; msg?: string };

export default function AiPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  // Pusty = klucz niezmieniony (placeholder pokaże, czy jakiś jest zapisany).
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    void window.luma.ai.getConfig().then(setCfg);
  }, []);

  if (!cfg) {
    return (
      <div className="panel">
        <header className="panel__header">
          <span className="panel__title">AGENT AI</span>
          <button className="panel__close" onClick={onClose} aria-label="Zamknij">
            ✕
          </button>
        </header>
        <div className="panel__body">
          <div className="panel__hint">ładowanie…</div>
        </div>
      </div>
    );
  }

  const update = (patch: Partial<AiConfig>): void => setCfg({ ...cfg, ...patch });

  const changeProvider = (provider: AiConfig['provider']): void => {
    update({ provider, baseUrl: BASE_URL_FOR[provider] ?? cfg.baseUrl });
  };

  /** Zapisuje konfigurację (klucz tylko gdy wpisano); zwraca zapisany config. */
  const persist = async (): Promise<AiConfig> => {
    const saved = await window.luma.ai.saveConfig(
      { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model },
      apiKey.length > 0 ? apiKey : undefined
    );
    setCfg(saved);
    setApiKey('');
    return saved;
  };

  const save = async (): Promise<void> => {
    setStatus({ kind: 'busy', msg: 'Zapisywanie…' });
    try {
      await persist();
      setStatus({ kind: 'ok', msg: 'Zapisano.' });
    } catch (error) {
      setStatus({ kind: 'err', msg: (error as Error).message });
    }
  };

  const testAndLoad = async (): Promise<void> => {
    setStatus({ kind: 'busy', msg: 'Łączenie…' });
    try {
      await persist(); // test używa zapisanej konfiguracji
      const list = await window.luma.ai.listModels();
      setModels(list);
      setStatus({ kind: 'ok', msg: `Połączono — ${list.length} modeli.` });
    } catch (error) {
      setStatus({ kind: 'err', msg: (error as Error).message });
    }
  };

  const keyHint = cfg.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…';
  const keyPlaceholder = cfg.hasKey ? '•••••••• (klucz zapisany)' : keyHint;

  return (
    <div className="panel">
      <header className="panel__header">
        <span className="panel__title">AGENT AI</span>
        <button className="panel__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
      </header>

      <div className="panel__body">
        <section className="aiCfg">
          <label className="aiCfg__row">
            <span>Dostawca</span>
            <select value={cfg.provider} onChange={(e) => changeProvider(e.target.value as AiConfig['provider'])}>
              <option value="openai">OpenAI API</option>
              <option value="anthropic">Anthropic (Claude API)</option>
              <option value="local">Model lokalny (Ollama / LM Studio)</option>
              <option value="custom">Własny endpoint (zgodny z OpenAI)</option>
            </select>
          </label>

          {cfg.provider === 'anthropic' && (
            <p className="panel__hint">
              Klucz API to osobne, płatne konto Anthropic — subskrypcja Claude (Max) go NIE
              obejmuje. Chcesz użyć subskrypcji? Uruchom „Claude Code" z sekcji AGENT AI
              (loguje się kontem, bez klucza).
            </p>
          )}

          <label className="aiCfg__row">
            <span>Bazowy URL</span>
            <input
              type="text"
              value={cfg.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </label>

          <label className="aiCfg__row">
            <span>Klucz API</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyPlaceholder}
              autoComplete="off"
            />
          </label>

          <label className="aiCfg__row">
            <span>Model</span>
            <input
              type="text"
              list="ai-models"
              value={cfg.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="np. gpt-4o-mini"
            />
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          </label>

          <div className="aiCfg__actions">
            <button className="dialog__button dialog__button--primary" onClick={() => void save()}>
              Zapisz
            </button>
            <button className="dialog__button" onClick={() => void testAndLoad()}>
              Testuj i pobierz modele
            </button>
            {status.kind !== 'idle' && (
              <span className={`aiCfg__status aiCfg__status--${status.kind}`}>{status.msg}</span>
            )}
          </div>

          <p className="panel__hint">
            Klucz jest szyfrowany lokalnie (DPAPI) i nie opuszcza tego komputera. Modele woła
            proces główny — renderer nie zna klucza. Czat i narzędzia agenta dojdą w kolejnych
            etapach.
          </p>
        </section>
      </div>
    </div>
  );
}
