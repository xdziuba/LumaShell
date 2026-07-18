/**
 * Panel czatu AI (AI-1 + narzędzia read-only AI-2).
 *
 * Model odpowiada strumieniowo i może SAM sięgnąć po narzędzia tylko-do-odczytu (wyjście
 * terminala, zaznaczenie, lista sesji) w pętli agenta — bez wykonywania jakichkolwiek akcji.
 * Zaproponowane komendy renderują się jako bloki kodu z „Kopiuj"; pisanie do terminala i
 * akcje przychodzą dopiero w AI-3 (docs/architecture/09-agent-ai.md).
 */

import { useEffect, useRef, useState } from 'react';
import type { AiChatMessage, AiChatToolCall } from '@shared/types/ipc';
import type { AiConfig } from '@core/ai/provider';
import { activeTerminal, terminalWithSelection } from '../terminal/terminal-context';
import { TOOL_SPECS, actionSummary, requiresApproval, runTool, toolLabel } from '../ai/tools';

/** Ile ostatnich wierszy bufora dołączamy ręcznie jako „wyjście terminala". */
const RECENT_LINES = 60;
/** Twardy limit tur pętli agenta — zabezpieczenie przed zapętleniem na narzędziach. */
const MAX_STEPS = 8;

/** Rola systemowa: asystent czyta swobodnie, a akcje wykonuje dopiero po zgodzie (AI-3). */
const SYSTEM_PROMPT =
  'Jesteś asystentem wbudowanym w terminal LumaShell. Pomagasz z powłoką (PowerShell, ' +
  'bash, WSL), SSH, portami szeregowymi, siecią i kontenerami. Masz narzędzia TYLKO DO ODCZYTU ' +
  '(wyjście terminala, zaznaczenie, lista sesji) — używaj ich swobodnie, gdy pomagają. Masz też ' +
  'narzędzia AKCJI: send_to_terminal (wpisanie/uruchomienie komendy) i write_file (zapis pliku). ' +
  'KAŻDA akcja wymaga zgody użytkownika — zanim jej użyjesz, krótko wyjaśnij, co i po co zrobisz. ' +
  'Nie zakładaj, że akcja się powiodła, dopóki nie dostaniesz wyniku narzędzia. Domyślnie ' +
  'pokazuj komendę i wykonuj ją tylko wtedy, gdy użytkownik chce, żebyś to zrobił. Odpowiadaj ' +
  'zwięźle i po polsku.';

interface ChatMsg {
  id: string;
  /** 'tool' = krok narzędzia (informacyjny wpis między dymkami). */
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Dymek w trakcie strumieniowania (aktywny cel delt). */
  streaming?: boolean;
  /** Odpowiedź zakończona błędem (inne tło). */
  error?: boolean;
}

type Segment = { kind: 'text'; text: string } | { kind: 'code'; text: string };

/** Rozbija treść na tekst i bloki ```…``` — do renderowania komend z przyciskiem „Kopiuj". */
function splitSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```[^\n]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', text: content.slice(last, m.index) });
    segments.push({ kind: 'code', text: (m[1] ?? '').replace(/\n$/, '') });
    last = fence.lastIndex;
  }
  if (last < content.length) segments.push({ kind: 'text', text: content.slice(last) });
  return segments;
}

function CodeBlock({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="chat__code">
      <button className="chat__copy" onClick={copy} title="Kopiuj do schowka">
        {copied ? 'Skopiowano' : 'Kopiuj'}
      </button>
      <pre>{text}</pre>
    </div>
  );
}

function Row({ msg }: { msg: ChatMsg }): React.JSX.Element {
  if (msg.role === 'tool') {
    return <div className="chat__step">🔧 {msg.content}</div>;
  }
  return (
    <div className={`chat__msg chat__msg--${msg.role}${msg.error ? ' chat__msg--error' : ''}`}>
      {msg.role === 'assistant'
        ? splitSegments(msg.content).map((seg, i) =>
            seg.kind === 'code' ? <CodeBlock key={i} text={seg.text} /> : <span key={i}>{seg.text}</span>
          )
        : msg.content}
    </div>
  );
}

export default function AiChatPanel({
  onClose,
  onOpenConfig
}: {
  onClose: () => void;
  onOpenConfig: () => void;
}): React.JSX.Element {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // Oczekująca zgoda na akcję (AI-3): pętla agenta czeka na decyzję użytkownika.
  const [approval, setApproval] = useState<{ summary: string; resolve: (ok: boolean) => void } | null>(null);
  const requestIdRef = useRef<string | null>(null);
  // Rozmowa dla modelu (osobno od widoku): system + tury z narzędziami i ich wynikami.
  const convoRef = useRef<AiChatMessage[]>([{ role: 'system', content: SYSTEM_PROMPT }]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.luma.ai.getConfig().then(setCfg);
  }, []);

  // Delty strumienia dopisujemy do aktywnego dymka asystenta (tworzymy go przy pierwszej porcji).
  useEffect(
    () =>
      window.luma.ai.onChatDelta(({ requestId, delta }) => {
        if (requestId !== requestIdRef.current) return;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            copy[copy.length - 1] = { ...last, content: last.content + delta };
          } else {
            copy.push({ id: crypto.randomUUID(), role: 'assistant', content: delta, streaming: true });
          }
          return copy;
        });
      }),
    []
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const needsKey = cfg !== null && cfg.provider !== 'local' && !cfg.hasKey;

  const addStep = (text: string): void =>
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'tool', content: text }]);

  /** Domyka bieżący dymek strumienia tekstem miarodajnym z main (albo dodaje, gdy pusto). */
  const finalizeTurn = (text: string): void =>
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        copy[copy.length - 1] = { ...last, content: text, streaming: false };
      } else if (text) {
        copy.push({ id: crypto.randomUUID(), role: 'assistant', content: text });
      }
      return copy;
    });

  const markError = (message: string, aborted: boolean): void =>
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      const content = aborted ? '⏹ Przerwano.' : `⚠ ${message}`;
      if (last && last.role === 'assistant' && last.streaming) {
        copy[copy.length - 1] = { ...last, content: last.content || content, streaming: false, error: !aborted };
      } else {
        copy.push({ id: crypto.randomUUID(), role: 'assistant', content, error: !aborted });
      }
      return copy;
    });

  /** Pętla agenta: model ↔ narzędzia, aż zwróci odpowiedź bez wywołań narzędzi. */
  const runAgentLoop = async (): Promise<void> => {
    for (let step = 0; step < MAX_STEPS; step++) {
      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;
      const result = await window.luma.ai.chat({
        requestId,
        messages: convoRef.current,
        tools: TOOL_SPECS
      });
      finalizeTurn(result.text);

      if (result.toolCalls.length === 0) {
        convoRef.current.push({ role: 'assistant', content: result.text });
        return;
      }

      // Zapisz turę z prośbą o narzędzia, wykonaj każde i dołącz wyniki.
      convoRef.current.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        const output = await handleToolCall(call);
        convoRef.current.push({ role: 'tool', toolCallId: call.id, content: output });
      }
    }
    addStep('Przerwano — przekroczono limit kroków narzędzi.');
  };

  /**
   * Wykonuje jedno wywołanie narzędzia. Read-only leci od razu; akcja (AI-3) przechodzi przez
   * bramkę zatwierdzania i zawsze trafia do dziennika audytowego — niezależnie od decyzji.
   */
  const handleToolCall = async (call: AiChatToolCall): Promise<string> => {
    if (!requiresApproval(call.name)) {
      addStep(toolLabel(call.name));
      return runTool(call.name, call.arguments);
    }

    const summary = actionSummary(call.name, call.arguments);
    const approved = await new Promise<boolean>((resolve) => setApproval({ summary, resolve }));
    setApproval(null);

    if (!approved) {
      window.luma.ai.logAction({ tool: call.name, summary, decision: 'denied' });
      addStep(`Odrzucono: ${summary}`);
      return 'Użytkownik odrzucił tę akcję.';
    }
    const outcome = await runTool(call.name, call.arguments);
    window.luma.ai.logAction({ tool: call.name, summary, decision: 'approved', outcome });
    addStep(`Wykonano: ${summary}`);
    return outcome;
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || streaming) return;

    convoRef.current.push({ role: 'user', content: text });
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }]);
    setInput('');
    setStreaming(true);
    try {
      await runAgentLoop();
    } catch (error) {
      const message = (error as Error).message || 'Błąd połączenia';
      markError(message, /abort/i.test(message));
    } finally {
      setStreaming(false);
      requestIdRef.current = null;
    }
  };

  const stop = (): void => {
    // W trakcie oczekiwania na zgodę „stop" oznacza odrzucenie akcji; poza tym przerywa strumień.
    if (approval) {
      approval.resolve(false);
      return;
    }
    if (requestIdRef.current) window.luma.ai.cancelChat(requestIdRef.current);
  };

  const clearChat = (): void => {
    setMessages([]);
    convoRef.current = [{ role: 'system', content: SYSTEM_PROMPT }];
  };

  const attach = (label: string, text: string): void => {
    if (!text.trim()) return;
    const block = `${label}:\n\`\`\`\n${text}\n\`\`\`\n`;
    setInput((prev) => (prev ? `${prev}\n${block}` : block));
  };
  const attachSelection = (): void =>
    attach('Zaznaczony tekst z terminala', terminalWithSelection()?.getSelection() ?? '');
  const attachOutput = (): void =>
    attach('Ostatnie wyjście terminala', activeTerminal()?.getRecentText(RECENT_LINES) ?? '');
  const attachFile = async (): Promise<void> => {
    const file = await window.luma.ai.pickTextFile();
    if (file) attach(`Plik ${file.name}`, file.content);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="panel panel--chat">
      <header className="panel__header">
        <span className="panel__title">CZAT AI</span>
        <div className="panel__header-actions">
          <button className="panel__link" onClick={onOpenConfig} title="Konfiguracja dostawcy AI">
            Konfiguracja
          </button>
          <button className="panel__link" onClick={clearChat} disabled={messages.length === 0}>
            Wyczyść
          </button>
          <button className="panel__close" onClick={onClose} aria-label="Zamknij">
            ✕
          </button>
        </div>
      </header>

      <div className="panel__body chat">
        {needsKey && (
          <div className="chat__notice">
            Dostawca „{cfg?.provider}" wymaga klucza API.{' '}
            <button className="panel__link" onClick={onOpenConfig}>
              Skonfiguruj
            </button>
            , albo uruchom Claude Code / Codex z sekcji AGENT AI (na subskrypcję).
          </div>
        )}

        <div className="chat__list" ref={listRef}>
          {messages.length === 0 && (
            <div className="chat__empty">
              Zapytaj o komendę, wklej błąd albo pozwól asystentowi zajrzeć w terminal. Ma
              narzędzia tylko do odczytu — proponuje, nie uruchamia niczego sam.
            </div>
          )}
          {messages.map((m) => (
            <Row key={m.id} msg={m} />
          ))}
        </div>

        {approval && (
          <div className="chat__approval">
            <div className="chat__approval-head">⚠ Model prosi o zgodę na akcję</div>
            <div className="chat__approval-body">{approval.summary}</div>
            <div className="chat__approval-actions">
              <button
                className="dialog__button dialog__button--primary"
                onClick={() => approval.resolve(true)}
              >
                Zatwierdź i wykonaj
              </button>
              <button className="dialog__button" onClick={() => approval.resolve(false)}>
                Odrzuć
              </button>
            </div>
          </div>
        )}

        <div className="chat__compose">
          <div className="chat__context">
            <button className="chat__chip" onClick={attachSelection} title="Dołącz zaznaczony tekst z terminala">
              + Zaznaczenie
            </button>
            <button className="chat__chip" onClick={attachOutput} title="Dołącz ostatnie wyjście terminala">
              + Wyjście terminala
            </button>
            <button className="chat__chip" onClick={() => void attachFile()} title="Dołącz zawartość pliku tekstowego">
              + Plik
            </button>
          </div>
          <div className="chat__input-row">
            <textarea
              className="chat__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Napisz wiadomość…  (Enter wysyła, Shift+Enter nowa linia)"
              rows={3}
            />
            {streaming ? (
              <button className="dialog__button" onClick={stop} title="Przerwij odpowiedź">
                Stop
              </button>
            ) : (
              <button
                className="dialog__button dialog__button--primary"
                onClick={() => void send()}
                disabled={!input.trim()}
              >
                Wyślij
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
