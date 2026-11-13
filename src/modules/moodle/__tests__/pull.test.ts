import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { verifyMoodle } from "@/lib/connectors/moodle/client";
import { MOODLE } from "@/lib/connectors/moodle/service";

import type { PullContext } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import moodle from "@/modules/moodle/manifest";
import { pullMoodle } from "@/modules/moodle/pull";

const SITE = "https://moodle.school.edu";
const API = `${SITE}/webservice/rest/server.php`;
const config = { site: SITE };
const secret = { token: "abcdef0123456789abcdef0123456789" };
const now = new Date("2026-11-11T15:00:00.000Z");

const event = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Essay ${id} is due`,
  timesort: 1_794_000_000 + id,
  modulename: "assign",
  instance: 100 + id,
  eventtype: "due",
  course: { id: 7, shortname: "BIO101", fullname: "Biology 101" },
  action: {
    name: "Add submission",
    url: `${SITE}/mod/assign/view.php?id=${id}`,
  },
  ...over,
});

const ctx = (
  http: PullContext["http"],
  over: Partial<PullContext> = {}
): PullContext => ({
  http,
  secret,
  config,
  settings: resolveSettings(moodle.connect!.settings, {}),
  now,
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
  ...over,
});

describe("verifyMoodle", () => {
  it("posts the key as a form, never in the URL, and names the user", async () => {
    const { http, calls } = fakeServiceHttp(
      MOODLE,
      [
        {
          method: "POST",
          url: API,
          json: { userid: 42, fullname: "Kai Soeno", sitename: "School" },
        },
      ],
      config
    );
    await expect(verifyMoodle({ http, secret, config })).resolves.toEqual({
      label: "Kai Soeno",
      config: { userid: "42", sitename: "School" },
    });
    expect(calls[0].url).toBe(API);
    expect(calls[0].body).toContain("wsfunction=core_webservice_get_site_info");
    expect(calls[0].body).toContain("moodlewsrestformat=json");
    expect(calls[0].url).not.toContain(secret.token);
  });

  it("reads invalidtoken, sent with HTTP 200, as a refused key", async () => {
    const { http } = fakeServiceHttp(
      MOODLE,
      [
        {
          method: "POST",
          url: API,
          json: {
            exception: "moodle_exception",
            errorcode: "invalidtoken",
            message: "Invalid token - token not found",
          },
        },
      ],
      config
    );
    await expect(verifyMoodle({ http, secret, config })).rejects.toMatchObject({
      kind: "auth",
    });
  });
});

describe("pullMoodle", () => {
  it("makes a task per assignment or quiz, filed under its course", async () => {
    const { http, calls } = fakeServiceHttp(
      MOODLE,
      [
        {
          method: "POST",
          url: API,
          body: /core_calendar_get_action_events_by_timesort/,
          json: {
            events: [
              event(1),
              event(2, { modulename: "quiz", name: "Quiz 2 closes" }),
              event(3, { modulename: "forum", name: "Forum" }),
            ],
            firstid: 1,
            lastid: 3,
          },
        },
      ],
      config
    );
    const result = await pullMoodle(ctx(http));
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      externalId: "1",
      title: "Essay 1 is due",
      state: "open",
      due: { at: new Date((1_794_000_000 + 1) * 1000) },
      url: `${SITE}/mod/assign/view.php?id=1`,
      group: { key: "moodle:course:7", label: "BIO101" },
    });
    expect(calls.every((c) => c.method === "POST")).toBe(true);
    const body = new URLSearchParams(calls[0].body ?? "");
    expect(body.get("timesortfrom")).toBe(
      String(Math.floor((now.getTime() - 14 * 86_400_000) / 1000))
    );
    expect(body.get("timesortto")).toBe(
      String(Math.floor((now.getTime() + 60 * 86_400_000) / 1000))
    );
  });

  it("finishes a held assignment that was submitted, and lets a held quiz go", async () => {
    const { http } = fakeServiceHttp(
      MOODLE,
      [
        {
          method: "POST",
          url: API,
          body: /get_action_events/,
          json: { events: [event(1)] },
        },
        {
          method: "POST",
          url: API,
          // The event's instance (108) is the course module; its assignment is 7.
          body: /core_course_get_course_module.*cmid=108|cmid=108.*core_course_get_course_module/,
          json: { cm: { id: 108, modname: "assign", instance: 7 } },
        },
        {
          method: "POST",
          url: API,
          body: /mod_assign_get_submission_status.*assignid=7|assignid=7.*mod_assign_get_submission_status/,
          json: {
            lastattempt: {
              submission: { status: "submitted", timemodified: 1_793_000_000 },
            },
          },
        },
      ],
      config
    );
    const result = await pullMoodle(
      ctx(http, {
        open: [
          { externalId: "1", kind: "task", title: "Essay 1 is due" },
          { externalId: "8", kind: "task", title: "Essay 8 is due" },
          { externalId: "9", kind: "task", title: "Quiz 9 closes" },
        ],
        cursor: {
          "8": { module: "assign", instance: 108 },
          "9": { module: "quiz", instance: 109 },
        },
      })
    );
    expect(result.complete).toBe(true);
    expect(result.items.find((i) => i.externalId === "8")).toMatchObject({
      state: "done",
      doneAt: new Date(1_793_000_000 * 1000),
    });
    expect(result.items.find((i) => i.externalId === "9")).toMatchObject({
      state: "gone",
    });
  });

  it("finishes a group assignment a teammate submitted", async () => {
    const { http } = fakeServiceHttp(
      MOODLE,
      [
        {
          method: "POST",
          url: API,
          body: /get_action_events/,
          json: { events: [] },
        },
        {
          method: "POST",
          url: API,
          body: /core_course_get_course_module/,
          json: { cm: { id: 108, modname: "assign", instance: 7 } },
        },
        {
          method: "POST",
          url: API,
          body: /mod_assign_get_submission_status/,
          json: {
            lastattempt: {
              submission: { status: "new", timemodified: 1_792_000_000 },
              teamsubmission: {
                status: "submitted",
                timemodified: 1_793_000_000,
              },
            },
          },
        },
      ],
      config
    );
    const result = await pullMoodle(
      ctx(http, {
        open: [{ externalId: "8", kind: "task", title: "Essay 8 is due" }],
        cursor: { "8": { module: "assign", instance: 108 } },
      })
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "8",
        state: "done",
        doneAt: new Date(1_793_000_000 * 1000),
      }),
    ]);
  });

  it("doesn't vouch for the rest when a check fails", async () => {
    const { http } = fakeServiceHttp(
      MOODLE,
      [
        {
          method: "POST",
          url: API,
          body: /get_action_events/,
          json: { events: [] },
        },
        {
          method: "POST",
          url: API,
          body: /mod_assign_get_submission_status/,
          json: { exception: "moodle_exception", errorcode: "invalidrecord" },
        },
      ],
      config
    );
    const result = await pullMoodle(
      ctx(http, {
        open: [{ externalId: "8", kind: "task", title: "Essay 8" }],
        cursor: { "8": { module: "assign", instance: 108 } },
      })
    );
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.cursor).toEqual({ "8": { module: "assign", instance: 108 } });
  });

  it("says it's incomplete when the page cap is hit", async () => {
    const page = Array.from({ length: 50 }, (_, i) => event(i + 1));
    const { http } = fakeServiceHttp(
      MOODLE,
      [{ method: "POST", url: API, json: { events: page, lastid: 50 } }],
      config
    );
    const result = await pullMoodle(ctx(http));
    expect(result.complete).toBe(false);
  });
});
