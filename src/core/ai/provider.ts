/**
 * Kontrakt dostawcy AI (AI-0).
 *
 * `core` — wyłącznie kontrakty, bez Node i bez sekretów. Wspólny interfejs pozwala wpiąć
 * OpenAI API, lokalny serwer (Ollama/LM Studio) albo własny endpoint zgodny z API OpenAI, a
 * w przyszłości Codex CLI (docs/architecture/09-agent-ai.md, Tryb D). Klucz API NIGDY nie
 * przechodzi tędy do renderera — trzymany jest w safeStorage w procesie głównym
 * (docs/security/02-sekrety.md).
 */

export type AiProviderKind = 'openai' | 'anthropic' | 'local' | 'custom';

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

/**
 * Deklaracja narzędzia dostępnego modelowi (AI-2). `parameters` to JSON Schema wejścia.
 * Format normalizujemy tu — dostawcy tłumaczą go na swoje API (OpenAI „functions",
 * Anthropic „tools").
 */
export interface AiToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Żądanie wywołania narzędzia zwrócone przez model. */
export interface AiToolCall {
  /** Identyfikator nadany przez dostawcę — potrzebny do dopięcia wyniku. */
  id: string;
  name: string;
  /** Argumenty sparsowane z JSON (puste, gdy model nie podał żadnych). */
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tura asystenta, która poprosiła o narzędzia. */
  toolCalls?: AiToolCall[];
  /** Wiadomość z wynikiem narzędzia — dowiązanie do konkretnego wywołania. */
  toolCallId?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** 0–2; niższa = bardziej deterministycznie. */
  temperature?: number;
  /** Narzędzia udostępnione modelowi w tej turze (AI-2). */
  tools?: AiToolSpec[];
}

/** Wynik jednej tury czatu: tekst (już wystrumieniowany deltami) i ewentualne wywołania narzędzi. */
export interface ChatResult {
  text: string;
  toolCalls: AiToolCall[];
}

/**
 * Dostawca AI. Implementacje żyją w `services/ai`. Poza listą modeli (test połączenia)
 * daje prymityw czatu z opcjonalnymi narzędziami — jedna tura pętli agenta (AI-2).
 */
export interface AiProvider {
  readonly kind: AiProviderKind;

  /** Lista modeli dostawcy — służy też jako test połączenia. */
  listModels(): Promise<AiModel[]>;

  /**
   * Jedna tura czatu. Delty tekstu (strumień) idą przez `onDelta`; zwraca tekst oraz
   * wywołania narzędzi, o które poprosił model (pusta tablica = odpowiedź końcowa).
   * `signal` pozwala przerwać (przycisk „stop"). Pętlę narzędzi prowadzi warstwa wyżej.
   */
  chat(request: ChatRequest, onDelta?: (delta: string) => void, signal?: AbortSignal): Promise<ChatResult>;
}

/** Domyślny bazowy URL dla trybu OpenAI API. */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Domyślny bazowy URL dla trybu Anthropic (Claude) API. */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
