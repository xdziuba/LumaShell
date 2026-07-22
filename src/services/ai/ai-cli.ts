/**
 * Uruchamianie oficjalnych CLI AI w panelu terminala (Tryb B — subskrypcja).
 *
 * Zamiast wołać API kluczem, owijamy zainstalowane narzędzia: Codex CLI (OpenAI) i Claude
 * Code (Anthropic). Sesja to PTY uruchamiające `codex` / `claude` — narzędzie loguje się
 * KONTEM użytkownika i samo trzyma tokeny. My ich nie dotykamy: żadnego czytania ciasteczek
 * przeglądarki ani przechwytywania sesji (docs/architecture/09-agent-ai.md, Tryb B).
 *
 * Dzięki temu użytkownik z subskrypcją ChatGPT Plus / Claude Max korzysta z modeli bez
 * osobnego, płatnego klucza API.
 */

import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { LocalPtyTransport } from '@services/pty/local-pty-transport';
import type { TerminalTransport } from '@core/transports/transport';
import type { AiCliAvailability, AiCliTool } from '@shared/types/ipc';

/** Nazwa pliku wykonywalnego dla danego narzędzia. */
const CLI_NAME: Record<AiCliTool, string> = {
  codex: 'codex',
  claude: 'claude'
};

/** Znajduje pełną ścieżkę pliku wykonywalnego w PATH (z wariantami .exe/.cmd na Windows). */
function findOnPath(executable: string): string | undefined {
  // Narzędzia npm na Windows to zwykle shimy .cmd, dlatego sprawdzamy też ten wariant.
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  const names = suffixes.map((s) => `${executable}${s}`);
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Sprawdza, które CLI AI są dostępne w PATH.
 *
 * Czyste wykrywanie — niczego nie uruchamia i nie loguje. UI używa tego, żeby włączyć albo
 * wyszarzyć szybki start danego narzędzia.
 */
export function detectAiClis(): AiCliAvailability {
  return {
    codex: findOnPath(CLI_NAME.codex) !== undefined,
    claude: findOnPath(CLI_NAME.claude) !== undefined
  };
}

/**
 * Buduje transport PTY uruchamiający wybrane CLI AI.
 *
 * Rzuca, gdy narzędzia nie ma w PATH — jawny błąd „zainstaluj codex/claude", nie ciche
 * uruchomienie nie tego, co trzeba. Narzędzie startuje bez argumentów: pierwsze uruchomienie
 * samo poprowadzi logowanie kontem.
 *
 * `cwd` jest tu kluczowe: oba narzędzia pracują na projekcie z katalogu, w którym wstały,
 * więc bez niego lądowały w katalogu domowym i nie widziały żadnego repozytorium.
 */
export function createAiCliTransport(
  id: string,
  options: { tool: AiCliTool; cwd?: string; columns: number; rows: number }
): TerminalTransport {
  const name = CLI_NAME[options.tool];
  const cli = findOnPath(name);
  if (!cli) {
    throw new Error(
      `Nie znaleziono „${name}" w PATH — zainstaluj narzędzie (${AI_CLI_INSTALL[options.tool]}) i spróbuj ponownie`
    );
  }

  return new LocalPtyTransport(id, {
    shell: cli,
    args: [],
    cwd: options.cwd,
    columns: options.columns,
    rows: options.rows
  });
}

/** Podpowiedź instalacyjna do komunikatu błędu. */
const AI_CLI_INSTALL: Record<AiCliTool, string> = {
  codex: 'npm i -g @openai/codex',
  claude: 'npm i -g @anthropic-ai/claude-code'
};
