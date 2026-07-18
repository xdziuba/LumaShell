/**
 * Narzędzia dla modelu: tylko-do-odczytu (AI-2) oraz akcje wymagające zatwierdzenia (AI-3).
 *
 * Narzędzia read-only model wywołuje swobodnie w pętli agenta (wyjście terminala,
 * zaznaczenie, lista sesji). Narzędzia akcji (`send_to_terminal`, `write_file`) mają
 * `requiresApproval` — pętla NIE wykona ich bez wyraźnej zgody użytkownika w UI, a każda
 * propozycja i decyzja trafia do dziennika audytowego (docs/architecture/09-agent-ai.md).
 * Wykonanie żyje w rendererze (bufory xterm, store); klucz i model zostają w main.
 */

import type { AiChatToolSpec } from '@shared/types/ipc';
import { leaves } from '@core/workspace/pane-tree';
import { useWorkspace } from '../store/workspace';
import { activeSessionId, activeTerminal, terminalWithSelection } from '../terminal/terminal-context';

export interface AiTool {
  spec: AiChatToolSpec;
  /** Akcja (zapis/wysłanie) — pętla musi najpierw uzyskać zgodę użytkownika. */
  requiresApproval?: boolean;
  /** Zwraca wynik jako tekst dla modelu (nigdy nie rzuca — błąd też jest tekstem). */
  run(args: Record<string, unknown>): string | Promise<string>;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

const TOOLS: AiTool[] = [
  {
    spec: {
      name: 'read_active_terminal',
      description:
        'Zwraca ostatnie wiersze wyjścia aktywnego terminala (to, co użytkownik ma na ekranie). ' +
        'Użyj, gdy pytanie dotyczy tego, co dzieje się w terminalu, błędu ostatniego polecenia itp.',
      parameters: {
        type: 'object',
        properties: {
          maxLines: { type: 'number', description: 'Ile ostatnich wierszy (domyślnie 60, maks. 400).' }
        }
      }
    },
    run: (args) => {
      const term = activeTerminal();
      if (!term) return 'Brak aktywnego terminala.';
      const lines = clamp(Number(args['maxLines']) || 60, 1, 400);
      return term.getRecentText(lines) || '(terminal jest pusty)';
    }
  },
  {
    spec: {
      name: 'read_terminal_selection',
      description: 'Zwraca tekst aktualnie zaznaczony w terminalu (pusty, gdy nic nie zaznaczono).',
      parameters: { type: 'object', properties: {} }
    },
    run: () => {
      const term = terminalWithSelection();
      const selection = term?.getSelection() ?? '';
      return selection.trim() || '(brak zaznaczenia)';
    }
  },
  {
    spec: {
      name: 'list_sessions',
      description:
        'Wypisuje otwarte sesje (zakładki i panele) z etykietą i typem: pty (powłoka), ssh, ' +
        'serial (port COM), network, container, ai-cli.',
      parameters: { type: 'object', properties: {} }
    },
    run: () => {
      const tabs = useWorkspace.getState().tabs;
      const rows: string[] = [];
      for (const tab of tabs) {
        if (tab.kind !== 'session') continue;
        for (const leaf of leaves(tab.root)) {
          rows.push(`- ${leaf.label} [${leaf.spec.kind}]`);
        }
      }
      return rows.length > 0 ? rows.join('\n') : 'Brak otwartych sesji.';
    }
  },
  // --- Akcje (AI-3) — wymagają zatwierdzenia użytkownika ---
  {
    spec: {
      name: 'send_to_terminal',
      description:
        'Wysyła tekst do aktywnej sesji terminala (powłoka, SSH, port szeregowy). Gdy ' +
        'execute=true, dopisuje Enter i uruchamia. WYMAGA zgody użytkownika. Zwraca tylko ' +
        'potwierdzenie wysłania — po wynik użyj potem read_active_terminal.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Tekst albo komenda do wysłania.' },
          execute: { type: 'boolean', description: 'Czy dopisać Enter i uruchomić (domyślnie false).' }
        },
        required: ['text']
      }
    },
    requiresApproval: true,
    run: async (args) => {
      const id = activeSessionId();
      if (!id) return 'Brak aktywnej sesji terminala.';
      const text = String(args['text'] ?? '');
      await window.luma.terminal.write(id, args['execute'] ? `${text}\r` : text);
      return args['execute']
        ? `Wysłano i uruchomiono: ${text}`
        : `Wpisano do terminala (bez uruchamiania): ${text}`;
    }
  },
  {
    spec: {
      name: 'write_file',
      description:
        'Zapisuje treść tekstową do pliku pod wskazaną ścieżką (np. skrypt, plik ' +
        'konfiguracyjny). WYMAGA zgody użytkownika. Nie nadaje się do danych binarnych.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Pełna ścieżka pliku do zapisania.' },
          content: { type: 'string', description: 'Treść do zapisania.' }
        },
        required: ['path', 'content']
      }
    },
    requiresApproval: true,
    run: async (args) => {
      const result = await window.luma.ai.writeFile(String(args['path'] ?? ''), String(args['content'] ?? ''));
      return result.message;
    }
  }
];

/** Deklaracje narzędzi wysyłane modelowi. */
export const TOOL_SPECS: AiChatToolSpec[] = TOOLS.map((t) => t.spec);

const BY_NAME = new Map(TOOLS.map((t) => [t.spec.name, t]));

/** Czytelna etykieta narzędzia do kroku w UI. */
export function toolLabel(name: string): string {
  switch (name) {
    case 'read_active_terminal':
      return 'Odczyt wyjścia terminala';
    case 'read_terminal_selection':
      return 'Odczyt zaznaczenia';
    case 'list_sessions':
      return 'Lista sesji';
    case 'send_to_terminal':
      return 'Wysłanie do terminala';
    case 'write_file':
      return 'Zapis pliku';
    default:
      return name;
  }
}

/** Czy narzędzie jest akcją wymagającą zgody użytkownika przed wykonaniem. */
export function requiresApproval(name: string): boolean {
  return BY_NAME.get(name)?.requiresApproval === true;
}

/** Zwięzły, czytelny opis akcji do bramki zatwierdzania i audytu. */
export function actionSummary(name: string, args: Record<string, unknown>): string {
  if (name === 'send_to_terminal') {
    const text = String(args['text'] ?? '');
    return args['execute'] ? `Uruchom w terminalu: ${text}` : `Wpisz w terminalu: ${text}`;
  }
  if (name === 'write_file') {
    const content = String(args['content'] ?? '');
    return `Zapis pliku ${String(args['path'] ?? '')} (${content.length} znaków)`;
  }
  return toolLabel(name);
}

/** Wykonuje narzędzie po nazwie; nieznane albo błąd → czytelny tekst dla modelu. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = BY_NAME.get(name);
  if (!tool) return `Nieznane narzędzie: ${name}`;
  try {
    return await tool.run(args);
  } catch (error) {
    return `Błąd narzędzia ${name}: ${(error as Error).message}`;
  }
}
