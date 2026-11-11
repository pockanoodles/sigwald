/**
 * Codeforces' pull: the round list and, with a handle, the user's rating.
 * Codeforces answers 200 with `status: "FAILED"` for a bad request (an
 * unknown handle), so that's read as a refusal too. It asks for no more than
 * one call every two seconds; a pull makes two, every six hours.
 * Docs: https://codeforces.com/apiHelp/methods#contest.list, #user.info
 */
import { ConnectorError } from "@/lib/connectors/errors";

import type {
  PullFn,
  PulledEvent,
  PulledReading,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

interface CfAnswer<T> {
  status: "OK" | "FAILED";
  comment?: string;
  result?: T;
}

interface Contest {
  id: number;
  name: string;
  type: string;
  phase: string;
  durationSeconds: number;
  startTimeSeconds?: number;
}

interface CfUser {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
}

function ok<T>(answer: CfAnswer<T>): T {
  if (answer.status !== "OK" || answer.result === undefined) {
    throw new ConnectorError(
      "config",
      `Codeforces: ${answer.comment ?? "it refused the request"}`
    );
  }
  return answer.result;
}

const AHEAD_MS = 30 * 86_400_000;
/** Codeforces takes one call every two seconds at most. */
export const CALL_GAP_MS = 2_100;
/** Rounds still to come or under way; a running round mustn't leave the calendar. */
const LIVE = new Set([
  "BEFORE",
  "CODING",
  "PENDING_SYSTEM_TEST",
  "SYSTEM_TEST",
]);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The pull, with the gap it leaves between its two calls (tests pass 0). */
export function codeforcesPull(gapMs: number): PullFn {
  return async ({ http, settings, now }) => {
    let called = false;
    const items: PulledEvent[] = [];
    if (setting.on(settings, "rounds")) {
      called = true;
      const contests = ok(
        await http.json<CfAnswer<Contest[]>>({
          url: "https://codeforces.com/api/contest.list",
          query: { gym: false },
        })
      );
      const busy = setting.on(settings, "busy");
      for (const c of contests) {
        if (!LIVE.has(c.phase) || !c.startTimeSeconds) continue;
        const start = new Date(c.startTimeSeconds * 1000);
        const end = new Date(start.getTime() + c.durationSeconds * 1000);
        if (start.getTime() - now.getTime() > AHEAD_MS || end <= now) continue;
        items.push({
          kind: "event",
          externalId: String(c.id),
          title: c.name,
          state: "open",
          start,
          end,
          busy,
          url: `https://codeforces.com/contests/${c.id}`,
        });
      }
    }

    const readings: PulledReading[] = [];
    const handle = setting.text(settings, "handle");
    if (handle) {
      if (called) await pause(gapMs);
      const [user] = ok(
        await http.json<CfAnswer<CfUser[]>>({
          url: "https://codeforces.com/api/user.info",
          query: { handles: handle },
        })
      );
      if (typeof user?.rating === "number") {
        readings.push({
          key: "rating",
          label: "Rating",
          value: user.rating,
          unit: "count",
        });
      }
      if (typeof user?.maxRating === "number") {
        readings.push({
          key: "maxrating",
          label: "Best rating",
          value: user.maxRating,
          unit: "count",
        });
      }
    }
    return { items, complete: true, readings };
  };
}

export const pullCodeforces: PullFn = codeforcesPull(CALL_GAP_MS);
