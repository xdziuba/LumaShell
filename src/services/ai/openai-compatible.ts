/**
 * Dostawca AI zgodny z API OpenAI (AI-0).
 *
 * Jedną implementacją obsługujemy trzy tryby z planu: OpenAI API (baseUrl api.openai.com/v1),
 * lokalny serwer (Ollama/LM Studio wystawiają ten sam protokół) i własny endpoint. Różni je
 * tylko `baseUrl` i obecność klucza. Działa w PROCESIE GŁÓWNYM — tu jest sieć i klucz API;
 * renderer nigdy nie woła modelu bezpośrednio (docs/security/01-model-procesow.md).
 */

import type { AiModel, AiProvider, AiProviderKind, ChatRequest } from '@core/ai/provider';

interface Options {
  kind: AiProviderKind;
  baseUrl: string;
  apiKey?: string;
}

/** Wyciąga czytelny komunikat błędu z odpowiedzi API (format OpenAI: { error: { message } }). */
async function errorMessage(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body?.error?.message ?? '';
  } catch {
    // odpowiedź bez JSON — zostaje sam status
  }
  return `Błąd API (${res.status})${detail ? `: ${detail}` : ''}`;
}

/** Czyta strumień SSE chat/completions, sklejając delty; woła onDelta na każdą porcję. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        // niepełna albo nie-JSON linia — pomijamy
      }
    }
  }
  return full;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly kind: AiProviderKind;
  readonly #baseUrl: string;
  readonly #apiKey: string | undefined;

  constructor(options: Options) {
    this.kind = options.kind;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#apiKey = options.apiKey;
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#apiKey) headers['Authorization'] = `Bearer ${this.#apiKey}`;
    return headers;
  }

  async listModels(): Promise<AiModel[]> {
    const res = await fetch(`${this.#baseUrl}/models`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const list = Array.isArray(body.data) ? body.data : [];
    return list
      .filter((m): m is { id: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id }));
  }

  async chat(
    request: ChatRequest,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const res = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        stream: true
      }),
      signal
    });
    if (!res.ok || !res.body) throw new Error(await errorMessage(res));
    return readStream(res.body, onDelta);
  }
}
