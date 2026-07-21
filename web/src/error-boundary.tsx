import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere in the tree and shows them on-screen
 * instead of a blank white page. Especially useful on mobile (no devtools
 * handy) — a real error message is readable and reportable; a blank page is
 * neither. In production you'd swap the body for a friendlier message, but
 * during bring-up the raw error + stack is what we want.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('UI error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { message, stack } = this.state.error;
    return (
      <div
        style={{
          padding: 24,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          color: '#2a2724',
          background: '#faf9f7',
          minHeight: '100vh',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxSizing: 'border-box',
        }}
      >
        <h2 style={{ fontFamily: '-apple-system, system-ui, sans-serif', color: '#c0623a', fontSize: 18 }}>
          Something went wrong
        </h2>
        <p style={{ fontFamily: '-apple-system, system-ui, sans-serif', fontSize: 14 }}>{message}</p>
        <pre style={{ marginTop: 12, fontSize: 11, lineHeight: 1.4 }}>{stack}</pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #c0623a',
            background: '#c0623a',
            color: '#fff',
            fontSize: 14,
            fontFamily: '-apple-system, system-ui, sans-serif',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
