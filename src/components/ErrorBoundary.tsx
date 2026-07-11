import { Component, type ReactNode } from "react";

type Fallback = ReactNode | ((error: Error, reset: () => void) => ReactNode);

interface Props {
  children: ReactNode;
  fallback: Fallback;
  /** When any value here changes, a caught error is cleared and children re-render.
   *  Used by the diff boundary to recover when a different file/commit is selected. */
  resetKeys?: unknown[];
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

function keysChanged(a?: unknown[], b?: unknown[]): boolean {
  if (!a || !b || a.length !== b.length) return a !== b;
  return a.some((v, i) => !Object.is(v, b[i]));
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && keysChanged(prev.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      return typeof fallback === "function" ? fallback(error, this.reset) : fallback;
    }
    return this.props.children;
  }
}
