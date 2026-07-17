/**
 * Dołączanie do kontenerów Docker i podów Kubernetes (Etap 7).
 *
 * Zamiast wciągać ciężkie SDK (dockerode, klient K8s), owijamy zainstalowane CLI: sesja to
 * PTY uruchamiające `docker exec -it` / `kubectl exec -it`. Pod ConPTY proces dostaje realny
 * TTY, więc `-t` działa jak w Windows Terminal. Bez nowych zależności.
 *
 * Bezpieczeństwo: proces jest uruchamiany z **tablicą argumentów** (nie przez powłokę), więc
 * nie ma wstrzyknięcia komend. Nazwy celu są dodatkowo walidowane w warstwie IPC, a `kubectl`
 * dostaje `--` przed powłoką, żeby nie dało się jej podsunąć jako flagi.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { LocalPtyTransport } from '@services/pty/local-pty-transport';
import type {
  ContainerExecOptions,
  ContainerInfo,
  TerminalTransport
} from '@core/transports/transport';
import { DEFAULT_SHELL, buildDockerExecArgs, buildKubectlExecArgs } from './exec-args.ts';

const run = promisify(execFile);

/** Znajduje pełną ścieżkę pliku wykonywalnego w PATH (z wariantem .exe na Windows). */
function findOnPath(executable: string): string | undefined {
  const names = process.platform === 'win32' ? [`${executable}.exe`, executable] : [executable];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Nazwa pliku CLI dla danego środowiska. */
function cliName(runtime: ContainerExecOptions['runtime']): string {
  return runtime === 'docker' ? 'docker' : 'kubectl';
}

/**
 * Buduje transport PTY dołączający do kontenera/poda.
 *
 * Rzuca, gdy CLI nie ma w PATH — to jawny błąd „zainstaluj docker/kubectl", nie ciche
 * uruchomienie nie tego, co trzeba.
 */
export function createContainerTransport(id: string, options: ContainerExecOptions): TerminalTransport {
  const cli = findOnPath(cliName(options.runtime));
  if (!cli) {
    throw new Error(`Nie znaleziono „${cliName(options.runtime)}" w PATH — zainstaluj narzędzie i spróbuj ponownie`);
  }

  const shell = options.shell || DEFAULT_SHELL;
  const args =
    options.runtime === 'docker'
      ? buildDockerExecArgs(options.target, shell)
      : buildKubectlExecArgs(options.target, options.namespace, shell);

  return new LocalPtyTransport(id, {
    shell: cli,
    args,
    columns: options.columns,
    rows: options.rows
  });
}

/**
 * Wykrywa uruchomione kontenery Docker.
 *
 * Cicho zwraca pustą listę, gdy Dockera nie ma albo demon nie działa — wykrywanie nie może
 * wywrócić interfejsu. Format bez tabeli, po jednym rekordzie w wierszu.
 */
async function listDockerContainers(): Promise<ContainerInfo[]> {
  const cli = findOnPath('docker');
  if (!cli) return [];
  try {
    const { stdout } = await run(cli, ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}'], {
      timeout: 4000,
      windowsHide: true
    });
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [target, image, status] = line.split('\t');
        return {
          runtime: 'docker' as const,
          target: target ?? '',
          detail: [image, status].filter(Boolean).join(' · ')
        };
      })
      .filter((c) => c.target.length > 0);
  } catch {
    return [];
  }
}

/**
 * Wykrywa pody Kubernetesa w bieżącym kontekście.
 *
 * Jak wyżej — cicho pusto, gdy brak kubectl albo kontekstu. Namespace trafia do `detail`,
 * ale exec i tak używa kontekstu domyślnego, chyba że użytkownik poda namespace w dialogu.
 */
async function listK8sPods(): Promise<ContainerInfo[]> {
  const cli = findOnPath('kubectl');
  if (!cli) return [];
  try {
    const { stdout } = await run(
      cli,
      ['get', 'pods', '--no-headers', '-o', 'custom-columns=NAME:.metadata.name,NS:.metadata.namespace,STATUS:.status.phase'],
      { timeout: 4000, windowsHide: true }
    );
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [target, ns, status] = line.trim().split(/\s+/);
        return {
          runtime: 'kubernetes' as const,
          target: target ?? '',
          detail: [ns, status].filter(Boolean).join(' · ')
        };
      })
      .filter((c) => c.target.length > 0);
  } catch {
    return [];
  }
}

/** Zbiorcze wykrycie kontenerów i podów; oba źródła równolegle, każde z osobna odporne. */
export async function listContainers(): Promise<ContainerInfo[]> {
  const [docker, k8s] = await Promise.all([listDockerContainers(), listK8sPods()]);
  return [...docker, ...k8s];
}
