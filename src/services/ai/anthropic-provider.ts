/**
 * Dostawca AI dla Anthropic (Claude) — API Messages.
 *
 * Protokół Anthropic różni się od OpenAI, więc to osobna implementacja `AiProvider`:
 * uwierzytelnianie nagłówkiem `x-api-key` (nie Bearer), wymagane `max_tokens`, prompt
 * systemowy jako osobne pole `system`, a strumień SSE ma typowane zdarzenia
 * (`content_block_delta`) zamiast porcji `choices[].delta`.
 *
 * Działa w PROCESIE GŁÓWNYM — tu jest sieć i klucz; renderer nigdy nie woła modelu wprost
 * (docs/security/01-model-procesow.md). UWAGA: klucz API to osobne, płatne konto Anthropic —
 * subskrypcja Claude (Max) go NIE obejmuje; ścieżka „na subskrypcję" to Claude Code CLI.
 */

import type { AiModel, AiProvider, ChatMessage, ChatRequest } from '@core/ai/provider';

interface Options {
  baseUrl: string;
  apiKey?: string;
}

/** Wersja API wymagana w nagłówku przez Anthropic. */
const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic wymaga limitu tokenów odpowiedzi — rozsądny domyślny sufit. */
const DEFAULT_MAX_TOKENS = 4096;

/** Wyciąga czytelny komunikat błędu (format Anthropic: { error: { message } }). */
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

/**
 * Dzieli wiadomości na prompt systemowy (osobne pole Anthropic) i właściwą rozmowę.
 *
 * Kolejne wpisy `system` są sklejane, a role user/assistant przechodzą bez zmian — API
 * Messages nie zna roli `system` w tablicy wiadomości.
 */
function splitSystem(messages: ChatMessage[]): {
  system: string | undefined;
  chat: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const systemParts: string[] = [];
  const chat: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.content);
    else chat.push({ role: m.role, content: m.content });
  }
  return { system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, chat };
}

/** Czyta strumień SSE Messages, sklejając delty tekstu; woła onDelta na każdą porcję. */
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
      // Interesują nas tylko linie z danymi; nazwy zdarzeń (event:) pomijamy.
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      try {
        const json = JSON.parse(data) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          const text = json.delta.text ?? '';
          if (text.length > 0) {
            full += text;
            onDelta?.(text);
          }
        }
      } catch {
        // niepełna albo nie-JSON linia — pomijamy
      }
    }
  }
  return full;
}

export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic' as const;
  readonly #baseUrl: string;
  readonly #apiKey: string | undefined;

  constructor(options: Options) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#apiKey = options.apiKey;
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION
    };
    if (this.#apiKey) headers['x-api-key'] = this.#apiKey;
    return headers;
  }

  async listModels(): Promise<AiModel[]> {
    const res = await fetch(`${this.#baseUrl}/models`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const body = (await res.json()) as { data?: Array<{ id?: unknown; display_name?: unknown }> };
    const list = Array.isArray(body.data) ? body.data : [];
    return list
      .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: typeof m.display_name === 'string' ? m.display_name : undefined }));
  }

  async chat(
    request: ChatRequest,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const { system, chat } = splitSystem(request.messages);
    const res = await fetch(`${this.#baseUrl}/messages`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        model: request.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
        ...(system ? { system } : {}),
        messages: chat,
        stream: true
      }),
      signal
    });
    if (!res.ok || !res.body) throw new Error(await errorMessage(res));
    return readStream(res.body, onDelta);
  }
}
