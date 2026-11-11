import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyGitlab } from "@/lib/connectors/gitlab/client";
import { GITLAB } from "@/lib/connectors/gitlab/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import gitlab from "@/modules/gitlab/manifest";
import { pullGitlab } from "@/modules/gitlab/pull";

const SITE = "https://gitlab.example.com";
const API = `${SITE}/api/v4`;
const config = { site: SITE, username: "kai" };
const now = new Date("2026-11-11T15:00:00.000Z");

const item = (
  kind: "issue" | "mr",
  iid: number,
  over: Record<string, unknown> = {}
) => ({
  id: 900 + iid,
  iid,
  project_id: 7,
  title: `Thing ${iid}`,
  description: "Body",
  web_url: `${SITE}/Acme/Web/-/${kind === "mr" ? "merge_requests" : "issues"}/${iid}`,
  state: "opened",
  labels: [],
  due_date: null,
  milestone: null,
  references: { full: `Acme/Web${kind === "mr" ? "!" : "#"}${iid}` },
  author: { username: "someone" },
  updated_at: "2026-11-11T12:00:00Z",
  closed_at: null,
  merged_at: null,
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "glpat-abcdefghijklmnopqrst" },
  config,
  settings: resolveSettings(gitlab.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const param = (url: string, name: string) =>
  new URL(url).searchParams.get(name);

describe("verifyGitlab", () => {
  it("sends the token in PRIVATE-TOKEN and names the account", async () => {
    const { http, calls } = fakeServiceHttp(
      GITLAB,
      [{ url: `${API}/user`, json: { username: "kai", name: "Kai" } }],
      config
    );
    await expect(
      verifyGitlab({ http, secret: { token: "glpat-x" }, config })
    ).resolves.toEqual({ label: "@kai", config: { username: "kai" } });
    expect(calls[0].headers["PRIVATE-TOKEN"]).toBe("glpat-x");
  });
});

describe("pullGitlab", () => {
  it("makes review and issue tasks, grouped by project path", async () => {
    const { http, calls } = fakeServiceHttp(
      GITLAB,
      [
        {
          url: `${API}/merge_requests`,
          json: [
            item("mr", 12, {
              labels: ["P1"],
              milestone: { title: "v2", due_date: "2026-11-20" },
              draft: true,
            }),
          ],
        },
        {
          url: `${API}/issues`,
          json: [
            item("issue", 3, { due_date: "2026-11-15", labels: ["bug"] }),
            item("issue", 4, {
              milestone: { title: "v3", due_date: "2026-12-01" },
            }),
          ],
        },
      ],
      config
    );
    const result = await pullGitlab(ctx(http));

    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.map((c) => param(c.url, "scope"))).toEqual([
      "all",
      "assigned_to_me",
    ]);
    expect(param(calls[0].url, "reviewer_username")).toBe("kai");
    expect(calls.every((c) => param(c.url, "state") === "opened")).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({
      externalId: "7!12",
      title: "Review: Thing 12",
      impact: 0.7,
      due: { date: "2026-11-20" },
      group: { key: "gitlab:project:acme/web", label: "web" },
    });
    expect(result.items[1]).toMatchObject({
      externalId: "7#3",
      title: "Thing 3",
      due: { date: "2026-11-15" },
      impact: null,
    });
    expect(result.items[2]).toMatchObject({ due: { date: "2026-12-01" } });
    expect(result.items[0]).toMatchObject({
      facts: expect.arrayContaining([
        { label: "Project", value: "acme/web" },
        { label: "Draft", value: "Yes" },
      ]),
    });
  });

  it("finishes held work that merged or closed, keeping its title", async () => {
    const { http, calls } = fakeServiceHttp(
      GITLAB,
      [
        {
          url: new RegExp(`${API}/merge_requests.*state=opened`),
          json: [],
        },
        {
          url: new RegExp(`${API}/merge_requests.*state=merged`),
          json: [
            item("mr", 12, {
              state: "merged",
              merged_at: "2026-11-11T10:00:00Z",
            }),
          ],
        },
        { url: new RegExp(`${API}/merge_requests.*state=closed`), json: [] },
        { url: new RegExp(`${API}/issues.*state=opened`), json: [] },
        {
          url: new RegExp(`${API}/issues.*state=closed`),
          json: [
            item("issue", 3, {
              state: "closed",
              closed_at: "2026-11-11T09:00:00Z",
            }),
          ],
        },
      ],
      config
    );
    const result = await pullGitlab(
      ctx(http, {
        open: [
          { externalId: "7!12", kind: "task", title: "Review: Thing 12" },
          { externalId: "7#3", kind: "task", title: "Thing 3" },
          { externalId: "7#99", kind: "task", title: "Quiet" },
        ],
        lastSuccessAt: new Date("2026-11-11T14:00:00Z"),
      })
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "7!12",
        title: "Review: Thing 12",
        state: "done",
        doneAt: new Date("2026-11-11T10:00:00Z"),
      }),
      expect.objectContaining({
        externalId: "7#3",
        title: "Thing 3",
        state: "done",
        doneAt: new Date("2026-11-11T09:00:00Z"),
      }),
    ]);
    const closed = calls.filter((c) => param(c.url, "state") !== "opened");
    expect(closed.every((c) => param(c.url, "updated_after"))).toBe(true);
    expect(result.complete).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("says it's partial when there are more pages than it reads", async () => {
    const { http } = fakeServiceHttp(
      GITLAB,
      [
        {
          url: `${API}/merge_requests`,
          json: [],
        },
        {
          url: `${API}/issues`,
          json: [item("issue", 3)],
          headers: {
            "content-type": "application/json",
            "x-next-page": "2",
          },
        },
      ],
      config
    );
    const result = await pullGitlab(ctx(http));
    expect(result.complete).toBe(false);
  });

  it("reads your own merge requests only when asked", async () => {
    const { http, calls } = fakeServiceHttp(
      GITLAB,
      [{ url: `${API}/merge_requests`, json: [item("mr", 5)] }],
      config
    );
    const result = await pullGitlab(
      ctx(http, {
        settings: resolveSettings(gitlab.connect!.settings, {
          reviews: false,
          issues: false,
          mine: true,
        }),
      })
    );
    expect(param(calls[0].url, "scope")).toBe("created_by_me");
    expect(result.items[0]).toMatchObject({ title: "Your MR: Thing 5" });
  });
});
