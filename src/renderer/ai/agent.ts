/**
 * Pętla agenta wieloetapowego (AI-5).
 *
 * Prowadzi rozmowę model ↔ narzędzia aż do odpowiedzi bez wywołań, pod kontrolą twardych
 * limitów: liczba kroków, liczba akcji (zatwierdzanych), budżet czasu, twarde przerwanie
 * (AbortSignal) i ponawianie przy błędach przejściowych. Zależności są wstrzykiwane, więc
 * logikę sterowania da się przetestować bez modelu ani UI (tests/unit/ai-agent.test.ts).
 *
 * Wykonanie akcji nadal wymaga zgody (AI-3) — runner pyta przez `requestApproval` i zapisuje
 * decyzję do audytu. Sam niczego nie wykonuje bez zgody.
 */

import type {
  AiActionLog,
  AiChatMessage,
  AiChatResult,
  AiChatToolCall,
  AiChatToolSpec
} from '@shared/types/ipc';

export type AgentStatus = 'completed' | 'aborted' | 'step-limit' | 'timeout' | 'error';

export interface AgentResult {
  status: AgentStatus;
  /** Ustawione przy statusie 'error' — czytelny komunikat. */
  error?: string;
}

/** Zależności wstrzykiwane (prawdziwe w rendererze, atrapy w teście). */
export interface AgentDeps {
  chat(req: { requestId: string; messages: AiChatMessage[]; tools: AiChatToolSpec[] }): Promise<AiChatResult>;
  runTool(name: string, args: Record<string, unknown>): Promise<string>;
  requiresApproval(name: string): boolean;
  actionSummary(name: string, args: Record<string, unknown>): string;
  toolLabel(name: string): string;
  /** Zegar (ms) — wstrzykiwany dla testu budżetu czasu. */
  now(): number;
  /** Odczekanie (backoff) — w teście natychmiastowe. */
  delay(ms: number): Promise<void>;
  genId(): string;
}

/** Wywołania zwrotne do UI (strumień, kroki, zgoda, audyt). */
export interface AgentHandlers {
  onTurnStart(requestId: string): void;
  onText(text: string): void;
  onStep(text: string): void;
  requestApproval(summary: string): Promise<boolean>;
  onAudit(entry: AiActionLog): void;
}

export interface AgentLimits {
  maxSteps: number;
  maxActions: number;
  timeoutMs: number;
  maxRetries: number;
  signal?: AbortSignal;
}

export const DEFAULT_LIMITS: Omit<AgentLimits, 'signal'> = {
  maxSteps: 12,
  maxActions: 10,
  timeoutMs: 180_000,
  maxRetries: 2
};

/** Błąd przejściowy (sieć, 5xx) — wart ponowienia. 4xx i abort — nie. */
function isTransient(message: string): boolean {
  if (/abort/i.test(message)) return false;
  // Błędy API 4xx to problem żądania (zły klucz, zły model) — ponawianie nie pomoże.
  if (/Błąd API \(4\d\d\)/.test(message)) return false;
  return true;
}

/**
 * Uruchamia pętlę agenta na przekazanej rozmowie (mutuje ją, dokładając tury i wyniki).
 * Nigdy nie rzuca — zwraca status; błąd modelu kończy się statusem 'error'.
 */
export async function runAgent(
  convo: AiChatMessage[],
  tools: AiChatToolSpec[],
  deps: AgentDeps,
  handlers: AgentHandlers,
  limits: AgentLimits
): Promise<AgentResult> {
  const start = deps.now();
  let actions = 0;

  const callChat = async (requestId: string): Promise<AiChatResult> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await deps.chat({ requestId, messages: convo, tools });
      } catch (error) {
        const message = (error as Error).message || 'Błąd połączenia';
        if (limits.signal?.aborted) throw error;
        if (attempt >= limits.maxRetries || !isTransient(message)) throw error;
        handlers.onStep(`Ponawiam po błędzie (${attempt + 1}/${limits.maxRetries})…`);
        await deps.delay(300 * (attempt + 1));
      }
    }
  };

  for (let step = 0; step < limits.maxSteps; step++) {
    if (limits.signal?.aborted) return { status: 'aborted' };
    if (deps.now() - start > limits.timeoutMs) return { status: 'timeout' };

    const requestId = deps.genId();
    handlers.onTurnStart(requestId);

    let result: AiChatResult;
    try {
      result = await callChat(requestId);
    } catch (error) {
      if (limits.signal?.aborted) return { status: 'aborted' };
      return { status: 'error', error: (error as Error).message || 'Błąd połączenia' };
    }

    handlers.onText(result.text);
    if (result.toolCalls.length === 0) {
      convo.push({ role: 'assistant', content: result.text });
      return { status: 'completed' };
    }

    convo.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      if (limits.signal?.aborted) return { status: 'aborted' };
      const output = await handleCall(call);
      convo.push({ role: 'tool', toolCallId: call.id, content: output });
    }
  }
  return { status: 'step-limit' };

  /** Jedno wywołanie narzędzia: read-only od razu, akcja przez bramkę zgody + audyt + limit akcji. */
  async function handleCall(call: AiChatToolCall): Promise<string> {
    if (!deps.requiresApproval(call.name)) {
      handlers.onStep(deps.toolLabel(call.name));
      return deps.runTool(call.name, call.arguments);
    }
    if (actions >= limits.maxActions) {
      handlers.onStep('Osiągnięto limit akcji — pomijam.');
      return 'Przekroczono limit akcji w tej turze; nie wykonano.';
    }
    const summary = deps.actionSummary(call.name, call.arguments);
    const approved = await handlers.requestApproval(summary);
    if (!approved) {
      handlers.onAudit({ tool: call.name, summary, decision: 'denied' });
      handlers.onStep(`Odrzucono: ${summary}`);
      return 'Użytkownik odrzucił tę akcję.';
    }
    actions++;
    const outcome = await deps.runTool(call.name, call.arguments);
    handlers.onAudit({ tool: call.name, summary, decision: 'approved', outcome });
    handlers.onStep(`Wykonano: ${summary}`);
    return outcome;
  }
}
