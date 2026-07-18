/**
 * Narzędzia tylko-do-odczytu dla modelu (AI-2).
 *
 * Model może SAM je wywołać w pętli agenta, żeby zajrzeć w to, co użytkownik i tak ma na
 * ekranie: wyjście aktywnego terminala, zaznaczenie, listę otwartych sesji. Nic tu nie
 * wykonuje poleceń ani nie zapisuje — pisanie do terminala i akcje przychodzą dopiero w
 * AI-3 (docs/architecture/09-agent-ai.md). Wykonanie żyje w rendererze, bo to tu są bufory
 * xterm i store; klucz i wywołanie modelu zostają w procesie głównym.
 */

import type { AiChatToolSpec } from '@shared/types/ipc';
import { leaves } from '@core/workspace/pane-tree';
import { useWorkspace } from '../store/workspace';
import { activeTerminal, terminalWithSelection } from '../terminal/terminal-context';

export interface AiTool {
  spec: AiChatToolSpec;
  /** Zwraca wynik jako tekst dla modelu (nigdy nie rzuca — błąd też jest tekstem). */
  run(args: Record<string, unknown>): string;
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
    default:
      return name;
  }
}

/** Wykonuje narzędzie po nazwie; nieznane albo błąd → czytelny tekst dla modelu. */
export function runTool(name: string, args: Record<string, unknown>): string {
  const tool = BY_NAME.get(name);
  if (!tool) return `Nieznane narzędzie: ${name}`;
  try {
    return tool.run(args);
  } catch (error) {
    return `Błąd narzędzia ${name}: ${(error as Error).message}`;
  }
}
