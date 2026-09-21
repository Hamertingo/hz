import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/// The floor under a render that throws.
///
/// React unmounts the whole tree when a render throws and nothing catches it, so
/// before this the window went blank with no message and no way back — the app
/// looked crashed while the process behind it was perfectly alive. Nothing in
/// this app had a `componentDidCatch` at all.
///
/// `resetKey` is the other half, and it is why this is not a plain boundary: one
/// caught error leaves the boundary latched, so without it a bad turn in one
/// session would keep the pane broken for every session selected after it. The
/// key is whatever the pane's identity is — session plus view — and a change to
/// it drops the error and re-renders the children.
type Props = {
  children: ReactNode;
  /// What the pane is showing. A new value clears a caught error.
  resetKey?: unknown;
  /// Named in the message, so the reader knows what failed rather than only that
  /// something did.
  subject?: string;
};

type State = { error: Error | null };

export default class RenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console keeps the whole thing, component stack included: this is the
    // only place the stack survives, since the panel below shows one sentence and
    // the clipboard copy is what the reader chooses to make.
    console.error("render failed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  /// Message plus where, for a reader pasting this into an issue. Deliberately
  /// not sent to analytics: an error message is arbitrary text and routinely
  /// carries a path (see the `error` event's own rule in CLAUDE.md).
  private details() {
    const { error } = this.state;
    const { subject } = this.props;
    return [
      subject ? `Hyze Code — ${subject}` : "Hyze Code",
      error?.name ? `${error.name}: ${error.message}` : String(error),
      "",
      error?.stack ?? "(no stack)",
    ].join("\n");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-xl border border-border/60 px-4 py-4">
          <p className="text-ui font-medium text-foreground">
            {this.props.subject ? `This ${this.props.subject} couldn't be drawn` : "This screen couldn't be drawn"}
          </p>
          {/* The message itself, not a generic apology: it is the one thing that
              says whether this is a bug here or a value that arrived wrong. */}
          <p className="text-ui break-words text-muted-foreground">{error.message}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => window.location.reload()}
              className="cursor-pointer"
            >
              Reload
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(this.details())}
              className="cursor-pointer"
            >
              Copy details
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
