import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  // Optional custom fallback for component-level wrapping. When provided, it is
  // rendered instead of the default full-page fallback (which is meant for
  // route-level boundaries). A small inline fallback keeps a crash in one
  // widget from taking down the surrounding page.
  fallback?: ReactNode;
  // Boundary inuti app-skalet (sidofält/header utanför): fallbacken fyller då
  // bara innehållsytan i stället för hela skärmen.
  inShell?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Component-level boundary: render the caller-provided inline fallback.
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <div className={`${this.props.inShell ? 'min-h-[60dvh]' : 'min-h-dvh bg-background'} flex items-center justify-center p-4`}>
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">
                Något gick fel
              </h1>
              <p className="text-sm text-muted-foreground">
                Ett oväntat fel uppstod. Försök ladda om sidan.
              </p>
            </div>
            {import.meta.env.DEV && this.state.error && (
              <pre className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 overflow-auto max-h-32 text-left">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Ladda om
              </button>
              {/* Vanlig länk (inte react-router Link): den globala boundaryn ligger
                  utanför routern, och en full sidladdning släpper ett trasigt tillstånd. */}
              <a
                href="/"
                className="inline-flex items-center px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
              >
                Till översikten
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
