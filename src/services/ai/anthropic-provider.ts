/**
 * Dostawca AI dla Anthropic (Claude) — API Messages (AI-0, narzędzia AI-2).
 *
 * Protokół Anthropic różni się od OpenAI, więc to osobna implementacja `AiProvider`:
 * uwierzytelnianie nagłówkiem `x-api-key` (nie Bearer), wymagane `max_tokens`, prompt
 * systemowy jako osobne pole `system`, narzędzia jako `tools`/`tool_use`/`tool_result`,
 * a strumień SSE ma typowane zdarzenia (`content_block_delta`, `input_json_delta`).
 *
 * Działa w PROCESIE GŁÓWNYM — tu jest sieć i klucz; renderer nigdy nie woła modelu wprost
 * (docs/security/01-model-procesow.md). UWAGA: klucz API to osobne, płatne konto Anthropic —
 * subskrypcja Claude (Max) go NIE obejmuje; ścieżka „na subskrypcję" to Claude Code CLI.
 */

import type {
  AiModel,
  AiProvider,
  AiToolCall,
  ChatMessage,
  ChatRequest,
  ChatResult
} from '@core/ai/provider';

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

/** Bezpieczne parsowanie argumentów narzędzia. Puste = {}. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}');
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface AnthropicBlock {
  type: string;
  [key: string]: unknown;
}
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

/**
 * Tłumaczy znormalizowane wiadomości na format Messages: prompt systemowy do osobnego pola,
 * `tool_use` w turze asystenta, `tool_result` w wiadomości user. Kolejne wyniki narzędzi
 * scala w jedną wiadomość user — Anthropic wymaga naprzemienności ról user/assistant.
 */
function toAnthropic(messages: ChatMessage[]): { system: string | undefined; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      const block: AnthropicBlock = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const content: AnthropicBlock[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
      }
      out.push({ role: 'assistant', content });
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  return { system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, messages: out };
}

interface ToolBlock {
  id: string;
  name: string;
  input: string;
}

/** Czyta strumień SSE Messages: skleja tekst (onDelta) oraz bloki tool_use (input po kawałku). */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void
): Promise<ChatResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  const blocks = new Map<number, ToolBlock>();

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
      try {
        const json = JSON.parse(data) as {
          type?: string;
          index?: number;
          content_block?: { type?: string; id?: string; name?: string };
          delta?: { type?: string; text?: string; partial_json?: string };
        };
        if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
          blocks.set(json.index ?? 0, {
            id: json.content_block.id ?? '',
            name: json.content_block.name ?? '',
            input: ''
          });
        } else if (json.type === 'content_block_delta') {
          if (json.delta?.type === 'text_delta') {
            const text = json.delta.text ?? '';
            if (text.length > 0) {
              full += text;
              onDelta?.(text);
            }
          } else if (json.delta?.type === 'input_json_delta') {
            const block = blocks.get(json.index ?? 0);
            if (block) block.input += json.delta.partial_json ?? '';
          }
        }
      } catch {
        // niepełna albo nie-JSON linia — pomijamy
      }
    }
  }

  const toolCalls: AiToolCall[] = [...blocks.values()]
    .filter((b) => b.name.length > 0)
    .map((b) => ({ id: b.id, name: b.name, arguments: parseArgs(b.input) }));
  return { text: full, toolCalls };
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
  ): Promise<ChatResult> {
    const { system, messages } = toAnthropic(request.messages);
    const res = await fetch(`${this.#baseUrl}/messages`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        model: request.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
        ...(system ? { system } : {}),
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters
              }))
            }
          : {}),
        messages,
        stream: true
      }),
      signal
    });
    if (!res.ok || !res.body) throw new Error(await errorMessage(res));
    return readStream(res.body, onDelta);
  }
}
