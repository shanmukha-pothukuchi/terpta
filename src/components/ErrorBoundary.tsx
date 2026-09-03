import { Component, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

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
        <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-red-800">
            <TriangleAlert className="h-4 w-4" aria-hidden />
            Something went wrong
          </div>
          <p className="mt-2 break-words text-sm text-red-700">
            {this.state.error.message}
          </p>
          <button
            type="button"
            className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
