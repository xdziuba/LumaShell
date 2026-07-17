/**
 * Czyste budowanie argumentów `exec` dla Dockera i Kubernetesa (Etap 7).
 *
 * Wydzielone z container-exec, żeby dało się je przetestować jednostkowo bez wciągania
 * node-pty (moduł natywny). Funkcje są czyste: wejściem są zwalidowane nazwy, wyjściem
 * tablica argumentów przekazywana procesowi bez pośrednictwa powłoki.
 */

/** Domyślna powłoka w kontenerze — sh jest niemal wszędzie, bash bywa nieobecny. */
export const DEFAULT_SHELL = '/bin/sh';

/** Argumenty `docker exec -it <target> <shell>`. */
export function buildDockerExecArgs(target: string, shell = DEFAULT_SHELL): string[] {
  return ['exec', '-it', target, shell];
}

/**
 * Argumenty `kubectl exec -it <pod> [-n ns] -- <shell>`.
 *
 * `--` oddziela argumenty kubectl od komendy w podzie: powłoka nie zostanie zinterpretowana
 * jako flaga kubectl, nawet gdyby ktoś obszedł walidację.
 */
export function buildKubectlExecArgs(target: string, namespace?: string, shell = DEFAULT_SHELL): string[] {
  const args = ['exec', '-it', target];
  if (namespace) args.push('-n', namespace);
  args.push('--', shell);
  return args;
}
