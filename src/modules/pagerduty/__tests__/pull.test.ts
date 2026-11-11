import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyPagerduty } from "@/lib/connectors/pagerduty/client";
import { PAGERDUTY } from "@/lib/connectors/pagerduty/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import pagerduty from "@/modules/pagerduty/manifest";
import { pullPagerduty } from "@/modules/pagerduty/pull";

const API = "https://api.pagerduty.com";
const config = { userId: "PUSER1" };
const now = new Date("2026-11-11T15:00:00.000Z");

const oncall = (over: Record<string, unknown> = {}) => ({
  escalation_level: 1,
  start: "2026-11-12T13:00:00Z",
  end: "2026-11-19T13:00:00Z",
  schedule: {
    id: "PSCHED",
    summary: "Primary rotation",
    html_url: "https://acme.pagerduty.com/schedules/PSCHED",
  },
  escalation_policy: {
    id: "PPOL",
    summary: "Platform policy",
    html_url: "https://acme.pagerduty.com/escalation_policies/PPOL",
  },
  user: { id: "PUSER1" },
  ...over,
});

const incident = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  incident_number: 4021,
  title: "Checkout 500s",
  status: "triggered",
  urgency: "high",
  html_url: `https://acme.pagerduty.com/incidents/${id}`,
  created_at: "2026-11-11T14:00:00Z",
  last_status_change_at: "2026-11-11T14:05:00Z",
  service: { id: "PSVC", summary: "Checkout" },
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret: { token: "pdkey" },
  config,
  settings: resolveSettings(pagerduty.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyPagerduty", () => {
  it("sends the Token header and keeps your user id", async () => {
    const { http, calls } = fakeServiceHttp(PAGERDUTY, [
      {
        url: `${API}/users/me`,
        json: { user: { id: "PUSER1", name: "Kai", email: "k@x.io" } },
      },
    ]);
    await expect(
      verifyPagerduty({ http, secret: { token: "k" }, config: {} })
    ).resolves.toEqual({ label: "Kai", config: { userId: "PUSER1" } });
    expect(calls[0].headers.Authorization).toBe("Token token=k");
    expect(calls[0].headers.Accept).toBe(
      "application/vnd.pagerduty+json;version=2"
    );
  });
});

describe("pullPagerduty", () => {
  it("makes on-call events and incident tasks", async () => {
    const { http, calls } = fakeServiceHttp(PAGERDUTY, [
      {
        url: `${API}/oncalls`,
        json: {
          oncalls: [
            oncall(),
            oncall({ start: null, end: null, schedule: null }),
          ],
          more: false,
        },
      },
      {
        url: `${API}/incidents`,
        json: {
          incidents: [
            incident("PINC1"),
            incident("PINC2", { urgency: "low", status: "acknowledged" }),
          ],
          more: false,
        },
      },
    ]);
    const result = await pullPagerduty(ctx(http));

    expect(calls.every((c) => c.method === "GET")).toBe(true);
    const oncalls = new URL(calls[0].url).searchParams;
    expect(oncalls.get("user_ids[]")).toBe("PUSER1");
    expect(oncalls.get("since")).toBe("2026-11-11T15:00:00.000Z");
    expect(oncalls.get("until")).toBe("2026-11-25T15:00:00.000Z");
    expect(new URL(calls[1].url).searchParams.getAll("statuses[]")).toEqual([
      "triggered",
      "acknowledged",
    ]);

    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      kind: "event",
      title: "On call: Platform policy",
      busy: false,
      state: "open",
      start: new Date("2026-11-12T13:00:00Z"),
      end: new Date("2026-11-19T13:00:00Z"),
    });
    expect(result.items[1]).toMatchObject({
      kind: "task",
      externalId: "PINC1",
      title: "Incident: Checkout 500s",
      impact: 0.95,
      group: { key: "pagerduty:service:psvc", label: "Checkout" },
    });
    expect(result.items[2]).toMatchObject({ impact: 0.6 });
  });

  it("finishes held incidents that were resolved", async () => {
    const { http } = fakeServiceHttp(PAGERDUTY, [
      { url: `${API}/oncalls`, json: { oncalls: [], more: false } },
      { url: `${API}/incidents?`, json: { incidents: [], more: false } },
      {
        url: `${API}/incidents/PINC9`,
        json: {
          incident: incident("PINC9", {
            status: "resolved",
            resolved_at: "2026-11-11T14:30:00Z",
          }),
        },
      },
    ]);
    const result = await pullPagerduty(
      ctx(http, {
        open: [
          { externalId: "PINC9", kind: "task", title: "Incident: Old" },
          { externalId: "evt", kind: "event", title: "On call: X" },
        ],
      })
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "PINC9",
        title: "Incident: Old",
        state: "done",
        doneAt: new Date("2026-11-11T14:30:00Z"),
      }),
    ]);
    expect(result.complete).toBe(true);
  });

  it("is partial when there are more pages than it reads", async () => {
    const { http } = fakeServiceHttp(PAGERDUTY, [
      { url: `${API}/oncalls`, json: { oncalls: [oncall()], more: true } },
      { url: `${API}/incidents`, json: { incidents: [], more: false } },
    ]);
    const result = await pullPagerduty(ctx(http));
    expect(result.complete).toBe(false);
  });
});
