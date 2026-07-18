/**
 * Kontrakt dostawcy AI (AI-0).
 *
 * `core` — wyłącznie kontrakty, bez Node i bez sekretów. Wspólny interfejs pozwala wpiąć
 * OpenAI API, lokalny serwer (Ollama/LM Studio) albo własny endpoint zgodny z API OpenAI, a
 * w przyszłości Codex CLI (docs/architecture/09-agent-ai.md, Tryb D). Klucz API NIGDY nie
 * przechodzi tędy do renderera — trzymany jest w safeStorage w procesie głównym
 * (docs/security/02-sekrety.md).
 */

export type AiProviderKind = 'openai' | 'local' | 'custom';

/** Model dostępny u dostawcy. */
export interface AiModel {
  id: string;
  /** Etykieta do UI; gdy brak — używamy id. */
  label?: string;
}

/**
 * Konfiguracja AI widoczna dla renderera. Bez klucza — renderer dostaje tylko `hasKey`.
 */
export interface AiConfig {
  provider: AiProviderKind;
  /** Bazowy URL API zgodnego z OpenAI (kończy się na /v1). */
  baseUrl: string;
  /** Wybrany model. */
  model: string;
  /** Czy klucz API jest zapisany (sam klucz nie opuszcza procesu głównego). */
  hasKey: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** 0–2; niższa = bardziej deterministycznie. */
  temperature?: number;
}

/**
 * Dostawca AI. Implementacje żyją w `services/ai`. Na tym etapie (AI-0) potrzebujemy
 * listy modeli (test połączenia) i prymitywu czatu (użyty w kolejnych etapach).
 */
export interface AiProvider {
  readonly kind: AiProviderKind;

  /** Lista modeli dostawcy — służy też jako test połączenia. */
  listModels(): Promise<AiModel[]>;

  /**
   * Wysyła zapytanie czatu. Delty odpowiedzi (strumień) idą przez `onDelta`; zwraca pełny
   * tekst. `signal` pozwala przerwać (przycisk „stop" w kolejnych etapach).
   */
  chat(request: ChatRequest, onDelta?: (delta: string) => void, signal?: AbortSignal): Promise<string>;
}

/** Domyślny bazowy URL dla trybu OpenAI API. */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
