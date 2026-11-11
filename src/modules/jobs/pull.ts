/**
 * Job boards' pull: every board's postings, kept to the titles and places
 * asked for. A posting gone from its board is gone here (its task closes);
 * a board that fails to answer makes the pull partial without touching the
 * others' tasks.
 */
import { type BoardKind, postings } from "@/lib/connectors/jobboards/client";

import {
  type PullFn,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

function companyName(board: string): string {
  return board
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const pullJobs: PullFn = async ({ http, settings }) => {
  const boards = setting.list(settings, "boards");
  const words = setting.list(settings, "words").map((w) => w.toLowerCase());
  const places = setting.list(settings, "places").map((p) => p.toLowerCase());

  const items: PulledTask[] = [];
  let complete = true;
  for (const entry of boards) {
    const [kind, board] = entry.split(":") as [BoardKind, string];
    let found;
    try {
      found = await postings(http, kind, board);
    } catch (error) {
      complete = false;
      if (boards.length === 1) throw error;
      continue;
    }
    const company = companyName(board);
    for (const p of found) {
      const title = p.title.toLowerCase();
      if (words.length > 0 && !words.some((w) => title.includes(w))) continue;
      const where = p.location.toLowerCase();
      if (
        places.length > 0 &&
        !places.some((place) =>
          place === "remote"
            ? p.remote || where.includes("remote")
            : where.includes(place)
        )
      ) {
        continue;
      }
      items.push({
        kind: "task",
        externalId: `${kind}:${board.toLowerCase()}:${p.id}`,
        title: `Apply: ${p.title} at ${company}`,
        state: "open",
        url: p.url,
        group: {
          key: `jobs:board:${kind}:${board.toLowerCase()}`,
          label: company,
        },
        facts: [
          ...fact("Company", company),
          ...fact("Where", p.location),
          ...fact("Team", p.team),
          ...fact("Remote", p.remote ? "Yes" : null),
          ...fact("Posted", toDate(p.postedAt)?.toISOString().slice(0, 10)),
        ],
        updatedAt: toDate(p.postedAt),
      });
    }
  }
  return { items, complete };
};
