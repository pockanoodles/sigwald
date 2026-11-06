/**
 * An absolute URL for `path` on the origin the browser actually reaches.
 *
 * Behind a proxy (Tailscale Serve in front of `next start -H 127.0.0.1`),
 * middleware's `request.url` names the bind address, e.g.
 * https://localhost:3939, not the public host, so a redirect built from it
 * sends the browser to its own machine. NEXTAUTH_URL is the public origin;
 * the request is the fallback when it is unset, as in local dev.
 */
export function publicUrl(path: string, request: { url: string }): URL {
  return new URL(path, process.env.NEXTAUTH_URL || request.url);
}
