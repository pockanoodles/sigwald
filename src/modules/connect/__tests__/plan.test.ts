import {
  type HeldItem,
  type HeldTask,
  cleanResult,
  groupsOf,
  planPull,
} from "@/modules/connect/plan";
import {
  type PulledEvent,
  type PulledTask,
  dueAt,
  dueDay,
} from "@/modules/connect/pull";

const now = new Date("2026-11-11T15:00:00.000Z");
const earlier = new Date("2026-11-11T14:00:00.000Z");

const pulled = (id: string, over: Partial<PulledTask> = {}): PulledTask => ({
  kind: "task",
  externalId: id,
  title: `Task ${id}`,
  state: "open",
  url: `https://example.com/${id}`,
  ...over,
});

const heldTask = (over: Partial<HeldTask> = {}): HeldTask => ({
  id: "task-1",
  title: "Task a",
  description: null,
  dueDate: null,
  impact: null,
  duration: null,
  externalUrl: "https://example.com/a",
  externalListId: null,
  claims: [],
  status: "todo",
  completedAt: null,
  closedAt: null,
  ...over,
});

const held = (id: string, over: Partial<HeldItem> = {}): HeldItem => ({
  id: `item-${id}`,
  externalId: id,
  kind: "task",
  state: "open",
  doneAt: null,
  title: `Task ${id}`,
  url: `https://example.com/${id}`,
  facts: [],
  group: null,
  upstreamUpdatedAt: null,
  lastSeenAt: earlier,
  projectedAt: earlier,
  task: heldTask({
    id: `task-${id}`,
    title: `Task ${id}`,
    externalUrl: `https://example.com/${id}`,
  }),
  event: null,
  ...over,
});

const plan = (
  heldItems: HeldItem[],
  items: (PulledTask | PulledEvent)[],
  complete = true,
  maxOpen = 30
) =>
  planPull({
    held: heldItems,
    result: { items, complete },
    now,
    timeZone: "America/New_York",
    maxOpen,
  });

describe("planPull: tasks", () => {
  it("makes a task for new open work, due by the end of its day in the person's zone", () => {
    const { writes, counts } = plan(
      [],
      [pulled("a", { due: { date: "2026-11-20" }, impact: 0.7 })]
    );
    expect(counts.created).toBe(1);
    const write = writes[0];
    expect(write.heldId).toBeNull();
    expect(write.item).toMatchObject({ state: "open", title: "Task a" });
    expect(write.task).toMatchObject({
      kind: "create",
      fields: {
        title: "Task a",
        impact: 0.7,
        dueDate: new Date("2026-11-21T04:59:59.999Z"),
      },
    });
  });

  it("writes nothing when nothing changed", () => {
    const { writes } = plan([held("a")], [pulled("a")]);
    expect(writes).toEqual([]);
  });

  it("keeps the task in step with the source", () => {
    const { writes } = plan(
      [held("a")],
      [
        pulled("a", {
          title: "Renamed",
          group: { key: "repo:x/y", label: "y" },
        }),
      ]
    );
    expect(writes[0].task).toEqual({
      kind: "update",
      taskId: "task-a",
      change: {
        title: "Renamed",
        externalListId: "repo:x/y",
        claims: ["repo:x/y"],
      },
    });
  });

  it("finishes the task when the source finishes the work, at the source's time", () => {
    const doneAt = new Date("2026-11-11T13:30:00.000Z");
    const { writes, counts } = plan(
      [held("a")],
      [pulled("a", { state: "done", doneAt })]
    );
    expect(counts.finished).toBe(1);
    expect(writes[0].task).toMatchObject({
      kind: "update",
      change: { status: "completed", completedAt: doneAt, closedAt: null },
    });
    expect(writes[0].item).toMatchObject({ state: "done", doneAt });
  });

  it("closes the task of work that's gone, without finishing it", () => {
    const { writes, counts } = plan([held("a"), held("b")], [pulled("a")]);
    expect(counts.gone).toBe(1);
    expect(writes).toEqual([
      {
        heldId: "item-b",
        externalId: "b",
        item: { state: "gone" },
        task: { kind: "update", taskId: "task-b", change: { closedAt: now } },
        event: null,
      },
    ]);
  });

  it("marks nothing gone when the pull may have missed some", () => {
    const { writes, counts } = plan(
      [held("a"), held("b")],
      [pulled("a")],
      false
    );
    expect(counts.gone).toBe(0);
    expect(writes).toEqual([]);
  });

  it("opens a closed task again when the work comes back", () => {
    const back = held("a", {
      state: "gone",
      task: heldTask({ id: "task-a", closedAt: earlier }),
    });
    const { writes } = plan([back], [pulled("a")]);
    expect(writes[0].task).toMatchObject({ change: { closedAt: null } });
    expect(writes[0].item).toMatchObject({ state: "open" });
  });

  it("reopens a task the source finished and reopened, never one finished by hand", () => {
    const doneAt = new Date("2026-11-10T10:00:00.000Z");
    const bySource = held("a", {
      state: "done",
      doneAt,
      task: heldTask({
        id: "task-a",
        status: "completed",
        completedAt: doneAt,
      }),
    });
    expect(plan([bySource], [pulled("a")]).writes[0].task).toMatchObject({
      change: { status: "todo", completedAt: null },
    });

    const byHand = held("a", {
      task: heldTask({
        id: "task-a",
        status: "completed",
        completedAt: earlier,
      }),
    });
    expect(plan([byHand], [pulled("a")]).writes).toEqual([]);
  });

  it("never makes another task for one deleted by hand", () => {
    const deleted = held("a", { task: null, projectedAt: earlier });
    expect(plan([deleted], [pulled("a")]).writes).toEqual([]);
  });

  it("ignores work that was already done before Sigwald saw it", () => {
    expect(plan([], [pulled("a", { state: "done" })]).writes).toEqual([]);
  });

  it("keeps new work waiting while the open tasks fill maxOpen, and lets it in when room frees", () => {
    const full = plan(
      [held("a"), held("b")],
      [pulled("a"), pulled("b"), pulled("c"), pulled("d")],
      true,
      3
    );
    expect(full.counts).toMatchObject({ created: 1, waiting: 1 });
    expect(
      full.writes
        .filter((w) => w.task?.kind === "create")
        .map((w) => w.externalId)
    ).toEqual(["c"]);
    // d is still mirrored, waiting, with no task.
    expect(full.writes.find((w) => w.externalId === "d")).toMatchObject({
      task: null,
      heldId: null,
    });

    // b finishes: there's room for d.
    const waiting = held("d", { task: null, projectedAt: null });
    const later = plan(
      [held("a"), held("b"), held("c"), waiting],
      [pulled("a"), pulled("b", { state: "done" }), pulled("c"), pulled("d")],
      true,
      3
    );
    expect(later.writes.find((w) => w.externalId === "d")?.task).toMatchObject({
      kind: "create",
    });
  });

  it("counts held tasks a partial pull didn't see toward maxOpen", () => {
    const { counts } = plan([held("a"), held("b")], [pulled("c")], false, 2);
    expect(counts).toMatchObject({ created: 0, waiting: 1 });
  });
});

describe("planPull: events", () => {
  const event = (id: string, over: Partial<PulledEvent> = {}): PulledEvent => ({
    kind: "event",
    externalId: id,
    title: `Event ${id}`,
    state: "open",
    start: new Date("2026-11-12T15:00:00.000Z"),
    end: new Date("2026-11-12T15:30:00.000Z"),
    busy: true,
    ...over,
  });
  const heldEvent = (id: string, start: Date, end: Date): HeldItem =>
    held(id, {
      kind: "event",
      title: `Event ${id}`,
      url: null,
      task: null,
      projectedAt: null,
      event: {
        id: `event-${id}`,
        title: `Event ${id}`,
        description: null,
        location: null,
        start,
        end,
        allDay: false,
        transparency: "OPAQUE",
      },
    });

  it("puts new events on the calendar, busy or free", () => {
    const { writes } = plan([], [event("x", { busy: false, url: null })]);
    expect(writes[0].event).toMatchObject({
      kind: "put",
      eventId: null,
      fields: { title: "Event x", transparency: "TRANSPARENT" },
    });
  });

  it("moves an event in place, and takes a cancelled one off", () => {
    const h = heldEvent(
      "x",
      new Date("2026-11-12T15:00:00.000Z"),
      new Date("2026-11-12T15:30:00.000Z")
    );
    const moved = plan(
      [h],
      [
        event("x", {
          url: null,
          start: new Date("2026-11-12T16:00:00.000Z"),
          end: new Date("2026-11-12T16:30:00.000Z"),
        }),
      ]
    );
    expect(moved.writes[0].event).toMatchObject({
      kind: "put",
      eventId: "event-x",
    });
    const cancelled = plan([h], [event("x", { state: "done", url: null })]);
    expect(cancelled.writes[0].event).toEqual({
      kind: "remove",
      eventId: "event-x",
    });
  });

  it("leaves an event that's over on the calendar when it stops being listed", () => {
    const past = heldEvent(
      "x",
      new Date("2026-11-10T15:00:00.000Z"),
      new Date("2026-11-10T16:00:00.000Z")
    );
    expect(plan([past], []).writes[0].event).toBeNull();
    const forget = planPull({
      held: [past],
      result: { items: [], complete: true },
      now,
      timeZone: "UTC",
      maxOpen: 30,
      removePastEvents: true,
    });
    expect(forget.writes[0].event).toEqual({
      kind: "remove",
      eventId: "event-x",
    });
  });
});

describe("cleanResult", () => {
  it("drops what can't be used and holds the rest to size", () => {
    const result = cleanResult({
      complete: true,
      items: [
        pulled("a", {
          title: "  Spaced\n title  ",
          url: "javascript:alert(1)",
          impact: 4,
          minutes: 0.2,
        }),
        pulled("", {}),
        pulled("a", { title: "duplicate" }),
        pulled("b", {
          due: { date: "not a day" },
          claims: ["x", { key: "y", label: "Why" }, "x"],
        }),
        {
          kind: "event",
          externalId: "e",
          title: "Backwards",
          state: "open",
          start: now,
          end: earlier,
          busy: true,
        },
      ],
      readings: [
        { key: "subs", label: "Subscribers", value: 10, unit: "count" },
        { key: "Bad Key", label: "x", value: 1, unit: "count" },
        { key: "nan", label: "x", value: Number.NaN, unit: "count" },
        { key: "subs", label: "again", value: 11, unit: "count" },
      ],
    });
    expect(result.items.map((i) => i.externalId)).toEqual(["a", "b", "e"]);
    expect(result.items[0]).toMatchObject({
      title: "Spaced title",
      url: null,
      impact: 1,
      minutes: 1,
    });
    expect(result.items[1]).toMatchObject({
      due: null,
      claims: ["x", { key: "y", label: "Why" }],
    });
    const e = result.items[2] as PulledEvent;
    expect(e.end.getTime() - e.start.getTime()).toBe(30 * 60_000);
    expect(result.readings).toEqual([
      { key: "subs", label: "Subscribers", value: 10, unit: "count" },
    ]);
    expect(result.complete).toBe(true);
  });

  it("drops a due that isn't a real day or a plausible time, never moving it to another", () => {
    const result = cleanResult({
      complete: true,
      items: [
        pulled("a", { due: { date: "2026-02-31" } }),
        pulled("b", { due: { date: "0000-00-00" } }),
        pulled("c", { due: { at: new Date(0) } }),
        pulled("d", { due: { at: new Date("0001-01-01T00:00:00Z") } }),
        pulled("e", { due: { date: "2028-02-29" } }),
      ],
    });
    expect(result.items.map((i) => (i as PulledTask).due)).toEqual([
      null,
      null,
      null,
      null,
      { date: "2028-02-29" },
    ]);
  });

  it("collects the groups and named claims a goal can claim", () => {
    const result = cleanResult({
      complete: true,
      items: [
        pulled("a", {
          group: { key: "repo:a/b", label: "b" },
          claims: [{ key: "project:1", label: "Launch" }, "owner:a"],
        }),
      ],
    });
    expect(groupsOf(result)).toEqual({
      "repo:a/b": "b",
      "project:1": "Launch",
    });
  });
});

describe("planPull: a done report", () => {
  it("only finishes, never blanking what it doesn't restate", () => {
    const h = held("a", {
      group: "repo:x/y",
      task: heldTask({
        id: "task-a",
        title: "Task a",
        externalListId: "repo:x/y",
        claims: ["repo:x/y"],
      }),
    });
    const doneAt = new Date("2026-11-11T13:00:00.000Z");
    const { writes } = plan(
      [h],
      [
        {
          kind: "task",
          externalId: "a",
          title: "Task a",
          state: "done",
          doneAt,
        },
      ]
    );
    expect(writes[0].item).toEqual({ state: "done", doneAt, lastSeenAt: now });
    expect(writes[0].task).toEqual({
      kind: "update",
      taskId: "task-a",
      change: { status: "completed", completedAt: doneAt, closedAt: null },
    });
  });

  it("stays at the time first heard when it comes again, so a reopen still undoes it", () => {
    const first = new Date("2026-11-11T13:00:00.000Z");
    const finished = held("a", {
      state: "done",
      doneAt: first,
      task: heldTask({ id: "task-a", status: "completed", completedAt: first }),
    });
    // The same Inbox item sent again later, stamped with its own time.
    expect(
      plan([finished], [pulled("a", { state: "done", doneAt: now })]).writes
    ).toEqual([]);
    expect(plan([finished], [pulled("a")]).writes[0].task).toMatchObject({
      change: { status: "todo", completedAt: null },
    });
  });
});

describe("due helpers", () => {
  it("take a real day or moment, and nothing a service means as none", () => {
    expect(dueDay("2026-11-20T10:00:00Z")).toEqual({ date: "2026-11-20" });
    expect(dueDay("2026-02-31")).toBeNull();
    expect(dueDay("0000-00-00 00:00:00")).toBeNull();
    expect(dueAt(1_763_000_000)).toEqual({ at: new Date(1_763_000_000_000) });
    expect(dueAt(0)).toBeNull();
    expect(dueAt("0001-01-01T00:00:00Z")).toBeNull();
  });
});

describe("planPull: an item said to be gone", () => {
  it("closes its task undone, even when the pull vouches for nothing else", () => {
    const { writes, counts } = plan(
      [held("a"), held("b")],
      [{ kind: "task", externalId: "a", title: "Task a", state: "gone" }],
      false
    );
    expect(counts.gone).toBe(1);
    expect(writes).toEqual([
      {
        heldId: "item-a",
        externalId: "a",
        item: { state: "gone" },
        task: { kind: "update", taskId: "task-a", change: { closedAt: now } },
        event: null,
      },
    ]);
  });

  it("ignores one Sigwald never held", () => {
    expect(
      plan([], [{ kind: "task", externalId: "z", title: "Z", state: "gone" }])
        .writes
    ).toEqual([]);
  });
});
