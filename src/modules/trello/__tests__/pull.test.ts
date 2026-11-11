import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyTrello } from "@/lib/connectors/trello/client";
import { TRELLO } from "@/lib/connectors/trello/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import trello from "@/modules/trello/manifest";
import { pullTrello } from "@/modules/trello/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const secret = { key: "k".repeat(32), token: "ATTAtokentokentokentoken1234" };

const card = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Card ${id}`,
  desc: "Details",
  due: "2026-11-20T17:00:00.000Z",
  dueComplete: false,
  url: `https://trello.com/c/${id}`,
  idBoard: "B1",
  dateLastActivity: "2026-11-11T12:00:00.000Z",
  labels: [{ name: "High", color: "red" }],
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret,
  config: {},
  settings: resolveSettings(trello.connect!.settings, {}),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const routes = (cards: unknown[]) => [
  { url: "https://api.trello.com/1/members/me/cards", json: cards },
  {
    url: "https://api.trello.com/1/members/me/boards",
    json: [{ id: "B1", name: "Launch" }],
  },
];

describe("verifyTrello", () => {
  it("names the member and sends the key and token as a header", async () => {
    const { http, calls } = fakeServiceHttp(TRELLO, [
      {
        url: "https://api.trello.com/1/members/me",
        json: { id: "1", fullName: "Kaito S", username: "kaito" },
      },
    ]);
    await expect(verifyTrello({ http, secret, config: {} })).resolves.toEqual({
      label: "Kaito S (@kaito)",
    });
    expect(calls[0].headers.Authorization).toBe(
      `OAuth oauth_consumer_key="${secret.key}", oauth_token="${secret.token}"`
    );
    expect(calls[0].url).not.toContain(secret.token);
  });
});

describe("pullTrello", () => {
  it("makes tasks from open cards, grouped by board", async () => {
    const { http, calls } = fakeServiceHttp(TRELLO, routes([card("c1")]));
    const result = await pullTrello(ctx(http));
    expect(result.complete).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(calls.every((c) => !c.url.includes(secret.key))).toBe(true);
    expect(new URL(calls[0].url).searchParams.get("filter")).toBe("open");
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "c1",
        title: "Card c1",
        state: "open",
        due: { at: new Date("2026-11-20T17:00:00.000Z") },
        impact: 0.7,
        group: { key: "trello:board:b1", label: "Launch" },
        url: "https://trello.com/c/c1",
      }),
    ]);
  });

  it("finishes a held card whose due date is complete, and skips unknown ones", async () => {
    const { http } = fakeServiceHttp(
      TRELLO,
      routes([
        card("c1", { dueComplete: true }),
        card("c2", { dueComplete: true }),
        card("c3", { due: null, labels: [] }),
      ])
    );
    const result = await pullTrello(
      ctx(http, {
        open: [{ externalId: "c1", kind: "task", title: "Held" }],
      })
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "c1",
        title: "Held",
        state: "done",
        doneAt: new Date("2026-11-11T12:00:00.000Z"),
      }),
      expect.objectContaining({ externalId: "c3", due: null, impact: null }),
    ]);
  });
});
