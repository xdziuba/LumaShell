/**
 * Panel czatu AI (AI-1) — rozmowa z modelem, BEZ wykonywania akcji.
 *
 * Model odpowiada strumieniowo (delty po requestId). Można dołączyć kontekst z terminala:
 * zaznaczenie albo ostatnie wyjście — jako blok w treści wiadomości. Zaproponowane komendy
 * renderują się jako bloki kodu z przyciskiem „Kopiuj"; nic nie jest uruchamiane samo —
 * to celowa granica tego etapu (docs/architecture/09-agent-ai.md).
 */

import { useEffect, useRef, useState } from 'react';
import type { AiChatMessage } from '@shared/types/ipc';
import type { AiConfig } from '@core/ai/provider';
import { activeTerminal, terminalWithSelection } from '../terminal/terminal-context';

/** Ile ostatnich wierszy bufora dołączamy jako „wyjście terminala". */
const RECENT_LINES = 60;

/** Stała rola systemowa: asystent proponuje, ale nie wykonuje — zgodnie z granicą AI-1. */
const SYSTEM_PROMPT =
  'Jesteś asystentem wbudowanym w terminal LumaShell. Pomagasz z powłoką (PowerShell, ' +
  'bash, WSL), SSH, portami szeregowymi, siecią i kontenerami. Możesz proponować komendy w ' +
  'blokach kodu, ale NIE wykonujesz żadnych akcji — użytkownik sam decyduje, czy je uruchomić. ' +
  'Odpowiadaj zwięźle i po polsku.';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Ustawione, gdy odpowiedź zakończyła się błędem (inne tło dymka). */
  error?: boolean;
}

/** Segment odpowiedzi: zwykły tekst albo blok kodu (z przyciskiem kopiowania). */
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

function Bubble({ msg }: { msg: ChatMsg }): React.JSX.Element {
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
  const requestIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.luma.ai.getConfig().then(setCfg);
  }, []);

  // Delty strumienia dopisujemy do ostatniej wiadomości asystenta (po requestId).
  useEffect(
    () =>
      window.luma.ai.onChatDelta(({ requestId, delta }) => {
        if (requestId !== requestIdRef.current) return;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + delta };
          return copy;
        });
      }),
    []
  );

  // Autoprzewijanie na dół przy nowej treści.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Dostawcy sieciowi wymagają klucza; model lokalny nie. Podpowiadamy konfigurację.
  const needsKey = cfg !== null && cfg.provider !== 'local' && !cfg.hasKey;

  const attach = (label: string, text: string): void => {
    if (!text.trim()) return;
    const block = `${label}:\n\`\`\`\n${text}\n\`\`\`\n`;
    setInput((prev) => (prev ? `${prev}\n${block}` : block));
  };

  const attachSelection = (): void => {
    const term = terminalWithSelection();
    attach('Zaznaczony tekst z terminala', term?.getSelection() ?? '');
  };
  const attachOutput = (): void => {
    const term = activeTerminal();
    attach('Ostatnie wyjście terminala', term?.getRecentText(RECENT_LINES) ?? '');
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || streaming) return;

    const history: ChatMsg[] = [...messages, { id: crypto.randomUUID(), role: 'user', content: text }];
    setMessages([...history, { id: crypto.randomUUID(), role: 'assistant', content: '' }]);
    setInput('');

    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    setStreaming(true);

    const payload: AiChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content }))
    ];

    try {
      const { full } = await window.luma.ai.chat({ requestId, messages: payload });
      // Pełny tekst z main jest miarodajny — nadpisuje ewentualne rozjazdy delt.
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: full };
        return copy;
      });
    } catch (error) {
      const message = (error as Error).message || 'Błąd połączenia';
      const aborted = /abort/i.test(message);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            content: last.content || (aborted ? '⏹ Przerwano.' : `⚠ ${message}`),
            error: !aborted
          };
        }
        return copy;
      });
    } finally {
      setStreaming(false);
      requestIdRef.current = null;
    }
  };

  const stop = (): void => {
    if (requestIdRef.current) window.luma.ai.cancelChat(requestIdRef.current);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter wysyła, Shift+Enter dodaje nową linię (jak w komunikatorach).
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
          <button className="panel__link" onClick={() => setMessages([])} disabled={messages.length === 0}>
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
              Zapytaj o komendę, wklej błąd albo dołącz wyjście terminala. Asystent proponuje —
              nie uruchamia niczego sam.
            </div>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} msg={m} />
          ))}
        </div>

        <div className="chat__compose">
          <div className="chat__context">
            <button className="chat__chip" onClick={attachSelection} title="Dołącz zaznaczony tekst z terminala">
              + Zaznaczenie
            </button>
            <button className="chat__chip" onClick={attachOutput} title="Dołącz ostatnie wyjście terminala">
              + Wyjście terminala
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
