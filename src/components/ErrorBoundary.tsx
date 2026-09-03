import { Component, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors (including Convex useQuery errors for backend
 * functions that have not been deployed yet, mid-build) and shows a small
 * recoverable card instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="m-6 rounded-[10px] border border-[rgba(226,24,51,0.30)] bg-[rgba(226,24,51,0.10)] p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <TriangleAlert size={16} strokeWidth={1.5} className="shrink-0 text-umd" aria-hidden />
            Something went wrong
          </div>
          <p className="mt-2 break-words text-[12.5px] leading-[1.5] text-[#F4A3AE]">
            {this.state.error.message}
          </p>
          <button
            type="button"
            className="mt-3 flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-line-strong bg-[rgba(255,255,255,0.04)] px-3 text-[12.5px] font-medium text-ink transition-colors duration-150 hover:bg-[rgba(255,255,255,0.08)]"
            onClick={() => this.setState({ error: null })}
          >
            <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
