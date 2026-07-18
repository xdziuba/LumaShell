/**
 * Dostawca AI zgodny z API OpenAI (AI-0, narzędzia AI-2).
 *
 * Jedną implementacją obsługujemy trzy tryby z planu: OpenAI API (baseUrl api.openai.com/v1),
 * lokalny serwer (Ollama/LM Studio wystawiają ten sam protokół) i własny endpoint. Różni je
 * tylko `baseUrl` i obecność klucza. Działa w PROCESIE GŁÓWNYM — tu jest sieć i klucz API;
 * renderer nigdy nie woła modelu bezpośrednio (docs/security/01-model-procesow.md).
 */

import type {
  AiModel,
  AiProvider,
  AiProviderKind,
  AiToolCall,
  ChatMessage,
  ChatRequest,
  ChatResult
} from '@core/ai/provider';

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

/** Bezpieczne parsowanie argumentów narzędzia (model bywa niedokładny). Puste = {}. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}');
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Tłumaczy znormalizowane wiadomości na format OpenAI (tool_calls / rola tool). */
function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) }
        }))
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

/** Akumulator jednego wywołania narzędzia sklejanego ze strumienia (argumenty przychodzą we fragmentach). */
interface ToolAcc {
  id: string;
  name: string;
  args: string;
}

/**
 * Czyta strumień SSE chat/completions: skleja tekst (onDelta na każdą porcję) oraz wywołania
 * narzędzi (delty tool_calls indeksowane, argumenty sklejane po kawałku).
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void
): Promise<ChatResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  const tools = new Map<number, ToolAcc>();

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
      if (data === '[DONE]') return finalize(full, tools);
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
            };
          }>;
        };
        const delta = json.choices?.[0]?.delta;
        const content = delta?.content;
        if (typeof content === 'string' && content.length > 0) {
          full += content;
          onDelta?.(content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const entry = tools.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          tools.set(idx, entry);
        }
      } catch {
        // niepełna albo nie-JSON linia — pomijamy
      }
    }
  }
  return finalize(full, tools);
}

function finalize(text: string, tools: Map<number, ToolAcc>): ChatResult {
  const toolCalls: AiToolCall[] = [...tools.values()]
    .filter((t) => t.name.length > 0)
    .map((t) => ({ id: t.id || t.name, name: t.name, arguments: parseArgs(t.args) }));
  return { text, toolCalls };
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
  ): Promise<ChatResult> {
    const res = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        model: request.model,
        messages: toOpenAiMessages(request.messages),
        temperature: request.temperature,
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters }
              }))
            }
          : {}),
        stream: true
      }),
      signal
    });
    if (!res.ok || !res.body) throw new Error(await errorMessage(res));
    return readStream(res.body, onDelta);
  }
}
