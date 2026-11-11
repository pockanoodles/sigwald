/**
 * An `Http` that leaves at least `gapMs` between the starts of its requests,
 * for a service that limits how fast it may be asked (Transistor: ten in ten
 * seconds). Requests made at once still go out one gap apart.
 */
import type { Http, HttpRequest } from "./egress";

export function paced(http: Http, gapMs: number): Http {
  let next = 0;
  const wait = async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gapMs;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  };
  return {
    async request(req: HttpRequest) {
      await wait();
      return http.request(req);
    },
    async json<T>(req: HttpRequest | string) {
      await wait();
      return http.json<T>(req);
    },
    async text(req: HttpRequest | string) {
      await wait();
      return http.text(req);
    },
    get count() {
      return http.count;
    },
  };
}
