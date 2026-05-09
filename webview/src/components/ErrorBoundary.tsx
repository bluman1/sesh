import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Human-readable name of the surface being guarded (e.g. "Insights"). */
  surface: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Sesh] ${this.props.surface} crashed:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: "var(--sesh-space-5)",
            color: "var(--sesh-fg)",
            fontSize: "var(--sesh-text-base)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sesh-space-3)",
            maxWidth: "640px",
          }}
        >
          <div style={{ fontWeight: 600 }}>{this.props.surface} hit an error.</div>
          <div style={{ color: "var(--sesh-fg-muted)" }}>
            Switch tabs and back, or reload the window. Details in the developer console.
          </div>
          <pre
            style={{
              margin: 0,
              padding: "var(--sesh-space-2) var(--sesh-space-3)",
              background: "var(--sesh-bg-elevated)",
              borderRadius: "var(--sesh-radius-sm)",
              fontSize: "var(--sesh-text-xs)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
