import { parseInbox } from "@/modules/inbox/receive";

const now = new Date("2026-11-11T15:00:00.000Z");

describe("parseInbox", () => {
  it("takes one item, keyed so a retry is the same item", () => {
    const a = parseInbox(
      { title: "Send Mara the deck", due: "2026-11-20", url: "https://x.io/d" },
      now
    );
    const b = parseInbox(
      { title: "Send Mara the deck", due: "2026-11-20", url: "https://x.io/d" },
      now
    );
    expect(a).toEqual(b);
    expect("items" in a && a.items[0]).toMatchObject({
      kind: "task",
      title: "Send Mara the deck",
      state: "open",
      due: { date: "2026-11-20" },
      url: "https://x.io/d",
    });
    expect("items" in a && a.items[0].externalId).toMatch(
      /^auto:[0-9a-f]{24}$/
    );
  });

  it("takes a list, with ids, priorities, lists, times and done", () => {
    const result = parseInbox(
      {
        items: [
          {
            id: "crm-1",
            title: "Call back",
            priority: "High",
            minutes: 20,
            list: "Clients & Co",
          },
          {
            id: "cal-1",
            title: "Site visit",
            start: "2026-11-12T10:00:00-05:00",
            end: "2026-11-12T11:30:00-05:00",
          },
          { id: "crm-0", title: "Old", done: true },
        ],
      },
      now
    );
    expect("items" in result).toBe(true);
    if (!("items" in result)) return;
    expect(result.items[0]).toMatchObject({
      externalId: "crm-1",
      impact: 0.7,
      minutes: 20,
      group: { key: "inbox:list:clients-co", label: "Clients & Co" },
    });
    expect(result.items[1]).toMatchObject({
      kind: "event",
      busy: true,
      start: new Date("2026-11-12T15:00:00.000Z"),
      end: new Date("2026-11-12T16:30:00.000Z"),
    });
    expect(result.items[2]).toMatchObject({ state: "done", doneAt: now });
  });

  it("says what's wrong instead of guessing", () => {
    const problem = (raw: unknown) => {
      const r = parseInbox(raw, now);
      return "problem" in r ? r.problem : null;
    };
    expect(problem({})).toMatch(/title is needed/);
    expect(problem({ title: "x", due: "next friday" })).toMatch(
      /due must be a day/
    );
    expect(problem({ title: "x", due: "2026-11-20T10:00:00" })).toMatch(
      /due must be a day/
    );
    // A Date would make these March 3 and the 2027 they roll into.
    expect(problem({ title: "x", due: "2026-02-31" })).toMatch(
      /due isn't a real day/
    );
    expect(problem({ title: "x", due: "2026-13-45" })).toMatch(
      /due isn't a real day/
    );
    expect(problem({ title: "x", due: "0000-00-00" })).toMatch(
      /due isn't a real day/
    );
    expect(problem({ title: "x", start: "2026-02-31T10:00:00Z" })).toMatch(
      /start isn't a real time/
    );
    expect(problem({ title: "x", url: "javascript:alert(1)" })).toMatch(/url/);
    expect(problem({ title: "x", priority: "asap" })).toMatch(/priority/);
    expect(problem({ title: "x", id: "has spaces" })).toMatch(/id/);
    expect(
      problem({
        title: "x",
        start: "2026-11-12T10:00:00Z",
        end: "2026-11-12T09:00:00Z",
      })
    ).toMatch(/after start/);
    expect(
      problem({
        items: Array.from({ length: 51 }, (_, i) => ({ title: `t${i}` })),
      })
    ).toMatch(/at most 50/);
    expect(
      problem({
        items: [
          { id: "a", title: "x" },
          { id: "a", title: "y" },
        ],
      })
    ).toMatch(/repeats/);
    expect(problem("just text")).toMatch(/must be an object/);
  });
});
