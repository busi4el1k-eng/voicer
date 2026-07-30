// Error handling that never leaks internals to the client. Raw exception
// messages can contain file paths, database/ORM internals, bundler module ids
// or connection strings — none of that should reach the browser or be persisted
// where the UI renders it.

// A ClientError's message is intentionally safe to show to the user. Throw this
// for validation / expected failures ("Nothing to cut — add sectors first").
export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientError";
  }
}

// Full detail goes to the server log only; the client gets `fallback` unless the
// error was explicitly marked safe via ClientError.
export function toClientMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (err instanceof ClientError) return err.message;
  console.error("[server error]", err);
  return fallback;
}
