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
import type { AiPolicy } from '@shared/types/ipc';

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
  // Polityka autonomii agenta (AI-7).
  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  const [policySaved, setPolicySaved] = useState(false);

  useEffect(() => {
    void window.luma.ai.getConfig().then(setCfg);
    void window.luma.ai.getPolicy().then(setPolicy);
  }, []);

  const updatePolicy = (patch: Partial<AiPolicy>): void => {
    setPolicy((prev) => (prev ? { ...prev, ...patch } : prev));
    setPolicySaved(false);
  };
  const savePolicy = (): void => {
    if (!policy) return;
    void window.luma.ai.savePolicy(policy).then((saved) => {
      setPolicy(saved); // proces główny mógł przyciąć do zakresu
      setPolicySaved(true);
    });
  };

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
            proces główny — renderer nie zna klucza.
          </p>
        </section>

        {policy && (
          <section className="aiCfg aiCfg--policy">
            <div className="aiCfg__section-title">Polityka agenta (limity biegu)</div>

            <label className="aiCfg__row">
              <span>Maks. kroków</span>
              <input
                type="number"
                min={1}
                max={50}
                value={policy.maxSteps}
                onChange={(e) => updatePolicy({ maxSteps: Number(e.target.value) })}
              />
            </label>
            <label className="aiCfg__row">
              <span>Maks. akcji</span>
              <input
                type="number"
                min={0}
                max={50}
                value={policy.maxActions}
                onChange={(e) => updatePolicy({ maxActions: Number(e.target.value) })}
              />
            </label>
            <label className="aiCfg__row">
              <span>Budżet czasu (s)</span>
              <input
                type="number"
                min={10}
                max={1800}
                value={Math.round(policy.timeoutMs / 1000)}
                onChange={(e) => updatePolicy({ timeoutMs: Number(e.target.value) * 1000 })}
              />
            </label>
            <label className="aiCfg__row">
              <span>Budżet tokenów</span>
              <input
                type="number"
                min={0}
                max={10_000_000}
                step={1000}
                value={policy.tokenBudget}
                onChange={(e) => updatePolicy({ tokenBudget: Number(e.target.value) })}
              />
            </label>

            <div className="aiCfg__actions">
              <button className="dialog__button dialog__button--primary" onClick={savePolicy}>
                Zapisz politykę
              </button>
              {policySaved && <span className="aiCfg__status aiCfg__status--ok">Zapisano.</span>}
            </div>
            <p className="panel__hint">
              Limity pilnują biegu agenta: liczba tur z modelem, liczba zatwierdzanych akcji,
              maksymalny czas i budżet tokenów (0 = bez limitu kosztów). Każde wywołanie
              narzędzia trafia do dziennika (przycisk „Dziennik" w czacie).
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
