/**
 * Granica błędów renderera (Etap 8).
 *
 * Łapie wyjątki renderowania Reacta, zgłasza je do logu w procesie głównym i pokazuje
 * bezpieczny ekran zamiast białej strony — z opcją przeładowania, zgłoszenia problemu i
 * otwarcia logów. Musi być komponentem klasowym (React nie ma hooka na error boundary).
 */

import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    window.luma.diagnostics.reportError(`${error.stack ?? error.message}\n${info.componentStack ?? ''}`);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash__box">
          <div className="crash__title">Coś poszło nie tak</div>
          <p className="crash__msg">
            Interfejs napotkał nieoczekiwany błąd. Możesz przeładować okno albo zgłosić problem —
            szczegóły zapisaliśmy do logu.
          </p>
          <pre className="crash__detail">{error.message}</pre>
          <div className="crash__actions">
            <button
              className="dialog__button dialog__button--primary"
              onClick={() => location.reload()}
            >
              Przeładuj
            </button>
            <button className="dialog__button" onClick={() => window.luma.diagnostics.reportProblem()}>
              Zgłoś problem
            </button>
            <button className="dialog__button" onClick={() => window.luma.diagnostics.openLogs()}>
              Otwórz logi
            </button>
          </div>
        </div>
      </div>
    );
  }
}
