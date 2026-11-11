import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyGithub } from "@/lib/connectors/github/client";
import { GITHUB } from "@/lib/connectors/github/service";

import { type PullContext, impactFromLabels } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import github from "@/modules/github/manifest";
import { pullGithub } from "@/modules/github/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const SEARCH = "https://api.github.com/search/issues";

const issue = (
  repo: string,
  number: number,
  over: Record<string, unknown> = {}
) => ({
  number,
  title: `Thing ${number}`,
  html_url: `https://github.com/${repo}/issues/${number}`,
  repository_url: `https://api.github.com/repos/${repo}`,
  state: "open",
  body: "Body",
  labels: [],
  milestone: null,
  user: { login: "someone" },
  comments: 2,
  updated_at: "2026-11-11T12:00:00Z",
  closed_at: null,
  ...over,
});

const page = (items: unknown[]) => ({
  total_count: items.length,
  incomplete_results: false,
  items,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
  config: { login: "me" },
  settings: resolveSettings(github.connect!.settings, {}),
  now,
  timeZone: "America/New_York",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const query = (url: string) => new URL(url).searchParams.get("q");

describe("verifyGithub", () => {
  it("names the account by its login", async () => {
    const { http, calls } = fakeServiceHttp(GITHUB, [
      { url: "https://api.github.com/user", json: { login: "octocat" } },
    ]);
    await expect(
      verifyGithub({ http, secret: { token: "ghp_x" }, config: {} })
    ).resolves.toEqual({
      label: "@octocat",
      config: { login: "octocat" },
    });
    expect(calls[0].headers.Authorization).toBe("Bearer ghp_x");
  });
});

describe("pullGithub", () => {
  it("makes review and issue tasks, keyed by repo and number, claimable by repo", async () => {
    const pr = issue("Acme/Web", 7, {
      html_url: "https://github.com/Acme/Web/pull/7",
      pull_request: { merged_at: null },
      labels: [{ name: "P1" }],
      milestone: { title: "v2", due_on: "2026-11-20T08:00:00Z" },
    });
    const { http, calls } = fakeServiceHttp(GITHUB, [
      { url: /user-review-requested/, json: page([pr]) },
      {
        url: /assignee%3A%40me/,
        json: page([issue("acme/api", 3), { ...pr, title: "dup" }]),
      },
    ]);
    const result = await pullGithub(ctx(http));

    expect(calls.map((c) => query(c.url))).toEqual([
      "is:open is:pr user-review-requested:@me archived:false",
      "is:open is:issue assignee:@me archived:false",
    ]);
    expect(calls.every((c) => c.url.startsWith(SEARCH))).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      externalId: "acme/web#7",
      title: "Review: Thing 7",
      state: "open",
      impact: 0.7,
      due: { date: "2026-11-20" },
      group: { key: "repo:acme/web", label: "web" },
      claims: ["owner:acme"],
    });
    expect(result.items[1]).toMatchObject({
      externalId: "acme/api#3",
      title: "Thing 3",
      impact: null,
    });
  });

  it("finishes what it holds once it's closed or reviewed, keeping its title", async () => {
    const { http, calls } = fakeServiceHttp(GITHUB, [
      { url: /user-review-requested/, json: page([]) },
      {
        url: /is%3Aclosed\+assignee/,
        json: page([
          issue("acme/api", 3, {
            state: "closed",
            closed_at: "2026-11-11T10:00:00Z",
          }),
        ]),
      },
      {
        url: /reviewed-by/,
        json: page([
          issue("acme/web", 7, {
            updated_at: "2026-11-11T11:00:00Z",
            pull_request: {},
          }),
        ]),
      },
      { url: /author%3A%40me\+closed/, json: page([]) },
      { url: /assignee%3A%40me\+archived/, json: page([]) },
    ]);
    const result = await pullGithub(
      ctx(http, {
        open: [
          { externalId: "acme/api#3", kind: "task", title: "Thing 3" },
          { externalId: "acme/web#7", kind: "task", title: "Review: Thing 7" },
          { externalId: "acme/web#9", kind: "task", title: "Gone" },
        ],
        lastSuccessAt: new Date("2026-11-11T14:45:00.000Z"),
      })
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "acme/api#3",
        title: "Thing 3",
        state: "done",
        doneAt: new Date("2026-11-11T10:00:00Z"),
      }),
      expect.objectContaining({
        externalId: "acme/web#7",
        title: "Review: Thing 7",
        state: "done",
        doneAt: new Date("2026-11-11T11:00:00Z"),
      }),
    ]);
    // Asked from the day before the last pull, in the person's zone.
    expect(calls.map((c) => query(c.url))).toContain(
      "is:closed assignee:@me closed:>=2026-11-10 archived:false"
    );
    expect(result.complete).toBe(true);
  });

  it("keeps to the repos it's told to, and says when GitHub's answer was partial", async () => {
    const { http } = fakeServiceHttp(GITHUB, [
      {
        url: /user-review-requested/,
        json: {
          total_count: 500,
          incomplete_results: false,
          items: [issue("a/one", 1)],
        },
      },
      {
        url: /assignee/,
        json: {
          ...page([issue("b/two", 2), issue("a/one", 5)]),
          incomplete_results: true,
        },
      },
    ]);
    const result = await pullGithub(
      ctx(http, {
        settings: resolveSettings(github.connect!.settings, {
          only: ["A/One"],
        }),
      })
    );
    expect(result.items.map((i) => i.externalId)).toEqual([
      "a/one#1",
      "a/one#5",
    ]);
    expect(result.complete).toBe(false);
  });
});

describe("impactFromLabels", () => {
  it("reads common priority labels", () => {
    expect(impactFromLabels(["P0"], null)).toBe(0.9);
    expect(impactFromLabels(["priority: high"], null)).toBe(0.7);
    expect(impactFromLabels(["p2"], null)).toBe(0.4);
    expect(impactFromLabels(["low"], 0.5)).toBe(0.15);
    expect(impactFromLabels(["docs"], 0.5)).toBe(0.5);
  });
});
