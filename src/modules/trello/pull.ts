/**
 * Trello's pull: every open card you are a member of, with the board's name
 * for its group. A card whose due date is marked complete finishes its task
 * (at its last activity, the nearest time Trello gives); a card that was
 * archived or removed from you is simply gone from the answer.
 */
import {
  type TrelloCard,
  myBoards,
  myCards,
} from "@/lib/connectors/trello/client";

import {
  type PullFn,
  type PulledTask,
  dueAt,
  fact,
  impactFromLabels,
  toDate,
} from "@/modules/connect/pull";

function toTask(card: TrelloCard, boards: Map<string, string>): PulledTask {
  const labels = (card.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
  const board = boards.get(card.idBoard);
  return {
    kind: "task",
    externalId: card.id,
    title: card.name,
    state: "open",
    url: card.url ?? null,
    description: card.desc ? card.desc.slice(0, 4000) : null,
    due: dueAt(card.due),
    impact: impactFromLabels(labels),
    group: {
      key: `trello:board:${card.idBoard}`.toLowerCase(),
      label: board ?? "Trello board",
    },
    facts: [...fact("Board", board), ...fact("Labels", labels.join(", "))],
    updatedAt: toDate(card.dateLastActivity),
  };
}

export const pullTrello: PullFn = async (ctx) => {
  const { http, secret, now } = ctx;
  const [cards, boards] = await Promise.all([
    myCards(http, secret),
    myBoards(http, secret),
  ]);
  const held = new Map(ctx.open.map((o) => [o.externalId, o.title]));
  const items: PulledTask[] = [];
  for (const card of cards) {
    const task = toTask(card, boards);
    if (!card.dueComplete) {
      items.push(task);
      continue;
    }
    // A completed card only matters as a finish for work Sigwald holds open.
    const title = held.get(card.id);
    if (title === undefined) continue;
    items.push({
      ...task,
      title,
      state: "done",
      doneAt: toDate(card.dateLastActivity) ?? now,
    });
  }
  return { items, complete: true };
};
