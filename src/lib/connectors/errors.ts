/**
 * How a call to an outside service fails, in kinds the connect pane can word
 * plainly and the sync loop can act on (an `auth` failure marks the
 * connection, a `rate_limited` one waits). Plain data, safe anywhere.
 */

export type ConnectorErrorKind =
  /** It refused the token or password (401). */
  | "auth"
  /** It knows who's asking and won't show this (403). */
  | "forbidden"
  | "not_found"
  /** Too many requests: try later. */
  | "rate_limited"
  /** It failed on its side (5xx). */
  | "server"
  /** It couldn't be reached, or took too long. */
  | "network"
  /** It answered something Sigwald can't read. */
  | "bad_response"
  /** Sigwald refused to send it: a host, method or size its rules don't allow. */
  | "refused"
  /** Something the person set up is missing or wrong (no database picked). */
  | "config";

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
    readonly status?: number,
    /** Seconds the service asked to wait, when it said. */
    readonly retryAfter?: number
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export function isConnectorError(error: unknown): error is ConnectorError {
  return error instanceof ConnectorError;
}

/** One line for the connect pane: what went wrong, said plainly. */
export function connectorProblem(error: unknown, service: string): string {
  if (!(error instanceof ConnectorError)) {
    const text = error instanceof Error ? error.message : String(error);
    return clip(text.trim().split("\n")[0] || "Something went wrong");
  }
  switch (error.kind) {
    case "auth":
      return `${service} refused the token. Connect it again with a new one.`;
    case "forbidden":
      return `${service} won't show this to the token. Check what it's allowed to read.`;
    case "not_found":
      return clip(`${service} has nothing there: ${error.message}`);
    case "rate_limited":
      return `${service} asked Sigwald to slow down. It will try again later.`;
    case "server":
      return `${service} is having trouble (${error.status ?? "error"}). It will try again later.`;
    case "network":
      return `Couldn't reach ${service}. It will try again later.`;
    default:
      return clip(error.message);
  }
}

const MAX = 160;

function clip(text: string): string {
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}
