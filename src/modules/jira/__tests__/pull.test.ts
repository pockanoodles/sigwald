import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyJira } from "@/lib/connectors/jira/client";
import { JIRA } from "@/lib/connectors/jira/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import jira from "@/modules/jira/manifest";
import { impactOfPriority, pullJira } from "@/modules/jira/pull";

const SITE = "https://acme.atlassian.net";
const API = `${SITE}/rest/api/3`;
const config = { site: SITE, email: "kai@acme.io" };
const now = new Date("2026-11-11T15:00:00.000Z");

const issue = (key: string, over: Record<string, unknown> = {}) => ({
  id: key.replace(/\D/g, ""),
  key,
  fields: {
    summary: `Summary of ${key}`,
    duedate: null,
    priority: { name: "Medium" },
    status: { name: "In Progress" },
    project: { key: "ENG", name: "Engineering" },
    issuetype: { name: "Task" },
    labels: ["backend"],
    updated: "2026-11-11T12:00:00.000+0000",
    ...over,
  },
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "atatt-secret" },
  config,
  settings: resolveSettings(jira.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

const jqlOf = (url: string) => new URL(url).searchParams.get("jql");

describe("verifyJira", () => {
  it("sends Basic auth of email and token and names the account", async () => {
    const { http, calls } = fakeServiceHttp(
      JIRA,
      [{ url: `${API}/myself`, json: { accountId: "a1", displayName: "Kai" } }],
      config
    );
    await expect(
      verifyJira({ http, secret: { token: "tok" }, config })
    ).resolves.toEqual({ label: "Kai" });
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("kai@acme.io:tok").toString("base64")}`
    );
  });
});

describe("pullJira", () => {
  it("makes tasks from the search/jql endpoint, asking only for mapped fields", async () => {
    const { http, calls } = fakeServiceHttp(
      JIRA,
      [
        {
          url: `${API}/search/jql`,
          json: {
            issues: [
              issue("ENG-12", {
                duedate: "2026-11-20",
                priority: { name: "Highest" },
              }),
              issue("OPS-3", {
                priority: null,
                project: { key: "OPS", name: "Operations" },
              }),
            ],
            isLast: true,
          },
        },
      ],
      config
    );
    const result = await pullJira(ctx(http));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(jqlOf(calls[0].url)).toBe(
      "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
    );
    const fields = new URL(calls[0].url).searchParams.get("fields")!;
    expect(fields.split(",")).toContain("summary");
    expect(fields).not.toMatch(/description/);
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({
      externalId: "ENG-12",
      title: "ENG-12 Summary of ENG-12",
      url: `${SITE}/browse/ENG-12`,
      due: { date: "2026-11-20" },
      impact: 0.9,
      group: { key: "jira:project:eng", label: "Engineering" },
    });
    expect(result.items[1]).toMatchObject({
      externalId: "OPS-3",
      impact: null,
      due: null,
      group: { key: "jira:project:ops", label: "Operations" },
    });
  });

  it("follows nextPageToken and says it's partial past the page cap", async () => {
    const { http, calls } = fakeServiceHttp(
      JIRA,
      [
        {
          url: `${API}/search/jql`,
          json: { issues: [issue("ENG-1")], nextPageToken: "more" },
        },
      ],
      config
    );
    const result = await pullJira(ctx(http));
    expect(calls).toHaveLength(3);
    expect(new URL(calls[1].url).searchParams.get("nextPageToken")).toBe(
      "more"
    );
    expect(result.complete).toBe(false);
  });

  it("reads each held issue that dropped off: done finishes it, the rest are gone", async () => {
    const { http, calls } = fakeServiceHttp(
      JIRA,
      [
        {
          url: new RegExp(`${API}/search/jql.*statusCategory\\+%21%3D\\+Done`),
          json: { issues: [], isLast: true },
        },
        {
          url: `${API}/issue/ENG-7`,
          json: issue("ENG-7", {
            status: { name: "Done", statusCategory: { key: "done" } },
            statuscategorychangedate: "2026-11-11T09:30:00.000+0000",
          }),
        },
        // Still open, but no longer on a complete "assigned to me" search.
        { url: `${API}/issue/ENG-8`, json: issue("ENG-8") },
        // Deleted: Jira answers 404.
        {
          url: `${API}/issue/ENG-9`,
          status: 404,
          json: { errorMessages: ["Issue does not exist"] },
        },
      ],
      config
    );
    const result = await pullJira(
      ctx(http, {
        open: [
          { externalId: "ENG-7", kind: "task", title: "ENG-7 Old title" },
          { externalId: "ENG-8", kind: "task", title: "ENG-8 Quiet" },
          { externalId: "ENG-9", kind: "task", title: "ENG-9 Deleted" },
        ],
      })
    );
    expect(calls.slice(1).map((c) => new URL(c.url).pathname)).toEqual([
      "/rest/api/3/issue/ENG-7",
      "/rest/api/3/issue/ENG-8",
      "/rest/api/3/issue/ENG-9",
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "ENG-7",
        title: "ENG-7 Old title",
        state: "done",
        doneAt: new Date("2026-11-11T09:30:00.000Z"),
      }),
      {
        kind: "task",
        externalId: "ENG-8",
        title: "ENG-8 Quiet",
        state: "gone",
      },
      {
        kind: "task",
        externalId: "ENG-9",
        title: "ENG-9 Deleted",
        state: "gone",
      },
    ]);
    expect(result.complete).toBe(true);
  });
});

describe("impactOfPriority", () => {
  it("maps Jira's names", () => {
    expect(impactOfPriority("Highest")).toBe(0.9);
    expect(impactOfPriority("High")).toBe(0.7);
    expect(impactOfPriority("Medium")).toBe(0.4);
    expect(impactOfPriority("Low")).toBe(0.15);
    expect(impactOfPriority("Lowest")).toBe(0.15);
    expect(impactOfPriority("Whatever")).toBeNull();
  });
});
