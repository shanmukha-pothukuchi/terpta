import { ConvexError } from "convex/values";

/**
 * Human-readable text for an error thrown by a Convex function.
 *
 * Convex masks plain `Error` messages in production ("Server Error"), so the
 * backend throws `ConvexError`, whose payload crosses the wire intact. The
 * `Uncaught Error:` fallback keeps dev-mode messages readable too.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data: unknown = e.data;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data === "object" && "message" in data) {
      const m = (data as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m.trim();
    }
  }
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Uncaught (?:Convex)?Error:\s*([^\n]*)/);
  return (m ? m[1] : raw).trim() || "Something went wrong";
}
