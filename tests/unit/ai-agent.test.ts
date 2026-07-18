/**
 * Testy jednostkowe pętli agenta (AI-5).
 *
 * Sterowanie (limity kroków, budżet czasu, twarde przerwanie, retry) testujemy bez modelu
 * ani UI — wszystkie zależności są wstrzykiwane atrapami.
 *
 * Uruchomienie: node --experimental-transform-types tests/unit/ai-agent.test.ts
 */

import { runAgent, type AgentDeps, type AgentHandlers, type AgentLimits } from '../../src/renderer/ai/agent.ts';

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

interface ChatReq {
  requestId: string;
  messages: Array<{ role: string; content: string }>;
  tools: unknown[];
}

/** Buduje atrapy zależności; `chat` sterujemy funkcją per test. */
function makeDeps(
  chat: (req: ChatReq, call: number) => Promise<{ text: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>,
  overrides: Partial<AgentDeps> = {}
): { deps: AgentDeps; calls: () => number; toolRuns: string[] } {
  let calls = 0;
  const toolRuns: string[] = [];
  const deps: AgentDeps = {
    chat: (req) => chat(req as ChatReq, calls++),
    runTool: async (name) => {
      toolRuns.push(name);
      return `wynik ${name}`;
    },
    requiresApproval: (name) => name === 'act',
    actionSummary: (name) => `akcja ${name}`,
    toolLabel: (name) => name,
    now: () => 0,
    delay: async () => {},
    genId: () => `id-${calls}`,
    ...overrides
  };
  return { deps, calls: () => calls, toolRuns };
}

function makeHandlers(): { handlers: AgentHandlers; steps: string[]; texts: string[]; audits: Array<{ decision: string }>; approve: (v: boolean) => void } {
  const steps: string[] = [];
  const texts: string[] = [];
  const audits: Array<{ decision: string }> = [];
  let approveValue = true;
  const handlers: AgentHandlers = {
    onTurnStart: () => {},
    onText: (t) => texts.push(t),
    onStep: (s) => steps.push(s),
    requestApproval: async () => approveValue,
    onAudit: (e) => audits.push(e)
  };
  return { handlers, steps, texts, audits, approve: (v) => (approveValue = v) };
}

const LIMITS: AgentLimits = { maxSteps: 5, maxActions: 3, timeoutMs: 10_000, maxRetries: 2 };

async function main(): Promise<void> {
  // 1. Pętla wieloetapowa: tura z narzędziem read-only, potem odpowiedź końcowa.
  {
    const { deps, toolRuns } = makeDeps(async (_req, call) =>
      call === 0
        ? { text: 'czytam', toolCalls: [{ id: 't1', name: 'read', arguments: {} }] }
        : { text: 'gotowe', toolCalls: [] }
    );
    const { handlers, texts } = makeHandlers();
    const convo = [{ role: 'user' as const, content: 'zrób' }];
    const r = await runAgent(convo, [], deps, handlers, LIMITS);
    sprawdz('multi-step kończy się completed', r.status === 'completed', r.status);
    sprawdz('narzędzie read wykonane', toolRuns.join(',') === 'read', toolRuns.join(','));
    sprawdz('tekst końcowy zebrany', texts.includes('gotowe'));
    sprawdz('wynik narzędzia dopięty do rozmowy', convo.some((m) => m.role === 'tool'));
  }

  // 2. Limit kroków: model wiecznie prosi o narzędzie.
  {
    const { deps } = makeDeps(async () => ({ text: '', toolCalls: [{ id: 'x', name: 'read', arguments: {} }] }));
    const { handlers } = makeHandlers();
    const r = await runAgent([{ role: 'user', content: 'x' }], [], deps, handlers, { ...LIMITS, maxSteps: 3 });
    sprawdz('nieskończona pętla ucięta limitem kroków', r.status === 'step-limit', r.status);
  }

  // 3. Limit akcji: co turę akcja, zgoda zawsze — po maxActions kolejne są pomijane.
  {
    const { deps, toolRuns } = makeDeps(async () => ({ text: '', toolCalls: [{ id: 'a', name: 'act', arguments: {} }] }));
    const { handlers, audits } = makeHandlers();
    const r = await runAgent([{ role: 'user', content: 'x' }], [], deps, handlers, { ...LIMITS, maxSteps: 5, maxActions: 2 });
    sprawdz('po limicie akcji dalej pętla, ale bez nadmiaru wykonań', toolRuns.filter((t) => t === 'act').length === 2, String(toolRuns.length));
    sprawdz('audyt zapisał tylko zatwierdzone wykonane akcje', audits.filter((a) => a.decision === 'approved').length === 2, String(audits.length));
    sprawdz('bieg ostatecznie zatrzymany limitem kroków', r.status === 'step-limit', r.status);
  }

  // 4. Odrzucenie akcji: zgoda = false → akcja niewykonana, audyt denied, model dostaje info.
  {
    const { deps, toolRuns } = makeDeps(async (_req, call) =>
      call === 0
        ? { text: '', toolCalls: [{ id: 'a', name: 'act', arguments: {} }] }
        : { text: 'ok', toolCalls: [] }
    );
    const { handlers, audits, approve } = makeHandlers();
    approve(false);
    const r = await runAgent([{ role: 'user', content: 'x' }], [], deps, handlers, LIMITS);
    sprawdz('odrzucona akcja nie została wykonana', !toolRuns.includes('act'));
    sprawdz('audyt zapisał odrzucenie', audits.some((a) => a.decision === 'denied'));
    sprawdz('po odrzuceniu bieg kończy się normalnie', r.status === 'completed', r.status);
  }

  // 5. Twarde przerwanie: sygnał ustawiony po pierwszej turze → 'aborted', narzędzie nie rusza.
  {
    const controller = new AbortController();
    const { deps, toolRuns } = makeDeps(async () => {
      controller.abort();
      return { text: '', toolCalls: [{ id: 'r', name: 'read', arguments: {} }] };
    });
    const { handlers } = makeHandlers();
    const r = await runAgent([{ role: 'user', content: 'x' }], [], deps, handlers, { ...LIMITS, signal: controller.signal });
    sprawdz('abort kończy bieg statusem aborted', r.status === 'aborted', r.status);
    sprawdz('po abort narzędzie nie zostało wykonane', !toolRuns.includes('read'));
  }

  // 6. Retry: błąd przejściowy raz, potem sukces → completed, chat wołany dwa razy.
  {
    let attempts = 0;
    const { deps } = makeDeps(async () => {
      attempts++;
      if (attempts === 1) throw new Error('network fail');
      return { text: 'ok', toolCalls: [] };
    });
    const { handlers, steps } = makeHandlers();
    const r = await runAgent([{ role: 'user', content: 'x' }], [], deps, handlers, LIMITS);
    sprawdz('retry po błędzie przejściowym → completed', r.status === 'completed', r.status);
    sprawdz('chat wołany dwa razy (1 błąd + 1 sukces)', attempts === 2, String(attempts));
    sprawdz('krok „Ponawiam" zgłoszony', steps.some((s) => /Ponawiam/.test(s)));
  }

  // 7. Brak retry na 4xx: błąd 401 → error od razu, bez ponawiania.
  {
    let attempts = 0;
    const { deps } = makeDeps(async () => {
      attempts++;
      throw new Error('Błąd API (401): zły klucz');
    });
    const { handlers } = makeHandlers();
    const r = await runAgent([{ role: 'user', content: 'x' }], [], deps, handlers, LIMITS);
    sprawdz('4xx nie jest ponawiane', attempts === 1, String(attempts));
    sprawdz('status error z komunikatem 401', r.status === 'error' && (r.error ?? '').includes('401'), `${r.status}/${r.error}`);
  }

  // 8. Budżet czasu: zegar przeskakuje ponad limit → timeout przed wołaniem modelu.
  {
    const times = [0, 999_999];
    let i = 0;
    const { deps, calls } = makeDeps(async () => ({ text: 'x', toolCalls: [] }), {
      now: () => times[Math.min(i++, times.length - 1)]!
    });
    const { handlers } = makeHandlers();
    const r = await runAgent([{ role: 'user', content: 'x' }], [], deps, handlers, { ...LIMITS, timeoutMs: 1000 });
    sprawdz('przekroczony budżet czasu → timeout', r.status === 'timeout', r.status);
    sprawdz('po timeout model nie był wołany', calls() === 0, String(calls()));
  }

  console.log('\nWYNIKI (pętla agenta)');
  console.log('─'.repeat(56));
  for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
  console.log('─'.repeat(56));
  const bledy = wyniki.filter((w) => !w.ok).length;
  console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
  process.exit(bledy === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('Test wywrócił się:', error);
  process.exit(1);
});
