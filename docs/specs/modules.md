# Modules

Sigwald's core is Today, Focus, Calendar, Tasks, Settings and the `/modules` marketplace. Everything else is a module that each person turns on or off: Courses, Ladder, People, Training, Nutrition, Work and Code, and the connector modules that read other services (below). The core works with every module off, and it never imports a module. A module adds to the core through fixed slots, listed in four registries under `src/modules/`.

## What a module is made of

A module is split three ways so the browser bundle never pulls in server code.

**The manifest** (`src/modules/<id>/manifest.ts`, listed in `MODULES` in `src/modules/index.ts`) is plain data that any code can import:

| Field | What it is |
|---|---|
| `id`, `name`, `summary` | How the catalog names it. The id is one of `ModuleId` in `src/modules/types.ts`. |
| `shelf`, `madeFor` | Its shelf in the marketplace (`src/modules/shelves.ts`) and who it's made for, which the marketplace's search reads. |
| `connect` | Set for a connector module (below). |
| `defaultOn` | Whether it's on for someone who never touched it. |
| `page` | Its one entry in the rail: a path and the words ⌘K finds it by. |
| `sources` | The `Task.source` values it owns. While it's off, those tasks leave every list. |
| `linkLabels` | What a task's link says, per source ("Open in Canvas"). |
| `claimLabels` | What the goal form calls claiming every task of a source ("All Canvas work"). A source without one can't be claimed whole. |
| `adds`, `keeps`, `egress` | What the catalog tells a person: what it adds, what it stores, and everything it sends out of Sigwald. |

**The browser side** (`CLIENT_MODULES` in `src/modules/client.tsx`) holds its components. Each is optional and draws only while the module is on.

| Slot | Where it shows |
|---|---|
| `command` | Its "Go to" entry in ⌘K. |
| `Views`, `Actions` | The top bar, on its own page. Below desktop width a view switcher is one menu and an action with an icon shows only the icon. |
| `headingInViews` | Set when `Views` carries a heading of its own (Ladder: the cycle), so a narrow bar drops the page name for room. |
| `Settings` | Its row in `/modules`. |
| `Status` | One count in the top bar's status strip, on every page. |
| `FirstRun` | What Today offers before there's anything to rank. |
| `TodayTaskSection` | A section in Today's panel for the selected task. |
| `TaskBody`, `TaskContext`, `TaskPane` | Focus's work column, Focus's context column, and the task sheet's reading pane, for tasks from its own sources. |
| `useTasksLens` | What it adds to the Tasks page (below). |

**The server side** (`SERVER_MODULES` in `src/modules/server.ts`) holds what touches the database. The core calls these through `src/modules/hooks.ts`.

| Hook | What the core does with it |
|---|---|
| `jobs` | The background sync loop runs each one for everyone who has the module on, every tick. |
| `afterTasksChange` | Called whenever tasks are created or changed (`tasksChanged`), on or off. |
| `taskFacts` | Fields the module adds to tasks wherever the core hands them out (below). |
| `rankSignals` | What it tells Focus's ranking about tasks (below). |
| `claimKeys`, `claimOptions` | Keys a goal can claim a task by beyond its source and project, and the claims the goal form offers. |
| `proofItems` | Things it keeps that a boss can name as its proof, and how each one stands. |
| `search` | What the top bar's search finds among what it keeps (People: a person; Courses: a course or a file), a group per kind of thing. Each hit links to the module's page opened on it, so the page reads its own param (`UrlAsk`). Asked only while it's on. |

Which modules a person has on lives in the `UserModule` table, one row per module they've touched (`src/modules/state.ts`). No row means the module's default.

## On and off

Turning a module off deletes nothing. While it's off:

- its rail entry is gone, and its page says it's off (`ModuleGate`);
- its sources' tasks leave the task list, Today, Focus and the scheduler (`visibleSourceWhere`);
- its jobs don't run;
- its API routes answer 409 `module_off` (`moduleOffResponse` in `src/modules/api.ts`), so a script calling them fails loudly instead of reading stale data;
- its top bar, status count and Today section don't draw, and its task facts, rank signals and Tasks lens aren't asked.

`afterTasksChange`, `claimKeys`, `claimOptions` and `proofItems` still run while a module is off, so its data stays consistent and turning it back on finds everything in step.

## How a module talks to the core

**Task facts.** `taskFacts` returns fields per task, and the core spreads them onto the task in `GET /api/tasks`, `GET` and `PUT /api/tasks/:id`, the Focus queue and the briefing without reading them. Courses adds the course, Canvas's submission state, the share of the grade, the grade if a task in danger is missed, and the material count. Ladder adds the goals a task serves. Writes to a task keep only `Task`'s own columns, since clients send whole tasks back, facts included.

**Ranking.** The ranker (`src/lib/sigwald/rank-stage1.ts`) names no module. It reads three things a module can supply:

- `Task.impact`, how much a task matters from 0 to 1, set by the module that owns it (Courses: its share of the grade);
- `Task.closedAt`, set when the source closed a task without it being done (Canvas: missed, or the course ended);
- `rankSignals`: a `lift` from 0 to 1 for tasks the module vouches for (Ladder: the importance of a task's most important active goal), and `stakes` with a `stakesGroup` for the boost given to large work due far out (Courses: the share of the grade, within a course).

**The Tasks page.** `useTasksLens` is a hook that returns the module's lens while it's on and null while it's off (`src/components/tasks/lens.ts`). A lens can narrow the list, add tabs along the bottom, add sheet columns placed after a core column with their own sort, put a word on each task's row, add a control to a row's toolbar and a board card, and say which goal a new task starts with. Ladder's lens carries all of its goal UI on that page (a tab per top goal, the Goal column and picker); Courses' carries the Mat column.

## The boundary

`src/modules/__tests__/boundary.test.ts` reads every import in `src/`. Code outside a module may reach it only through the registries (`index.ts`, `client.tsx`, `server.ts`, `hooks.ts`). `OWNED` maps each module to the paths it owns, including Courses' and Ladder's files outside `src/modules/`. A coupling that has to exist for a while goes in `KNOWN` with what will remove it, and the test fails both on a new coupling and on a listed one that's gone. `KNOWN` is empty.

Two rules keep the bundles apart. `src/modules/index.ts` and the manifests are plain data, safe in the browser, and `server.ts` and `hooks.ts` are server only. `src/modules/state.ts` has no Next.js imports, so the sync worker can load it.

## Connector modules

A connector module reads one outside service (GitHub, Linear, Stripe, a public calendar link) and turns what it finds into Sigwald's own shapes: tasks, calendar events and daily readings. It is three small files, and the framework in `src/modules/connect/` does the rest.

**The service** (`src/lib/connectors/<service>/service.ts`, plain data) names the service, the connect form's fields (a `secret` is stored encrypted and never sent to the browser), where it may be reached (`HostRule`: fixed hosts, the address the person types, or any public address), whether it reads with POST (a GraphQL API), and its `egress` line. Its `client.ts` holds the calls, made through the `Http` it is handed, and a `verify` (one cheap "who am I" read, listed in `src/lib/connectors/verifiers.ts`) that runs before a connection is kept.

**The manifest's `connect`** (`ConnectSpec` in `src/modules/connect/spec.ts`) says which service it reads through (or none: Golden hour works its answer out locally, Inbox is sent things), what it `makes`, how often it reads, and its settings as plain fields, from which the marketplace pane draws its form.

**The pull** (`src/modules/<id>/pull.ts`) is one function: given an `Http` that can reach only its service, the connection's fields and its settings, it answers with what it saw (`PullResult`). It never touches the database, so a test runs it against recorded answers (`fakeServiceHttp`), through the real egress. Its entry in each registry is one line: `connectorServer(id, pull)` and `connectorClient(id)`.

What the framework does with an answer (`src/modules/connect/plan.ts`):

- Each thing read is mirrored once (`ModuleItem`) and its task or event is a projection of the mirror, the way a Work shift is the truth behind its calendar event. Events go on a LOCAL calendar per module.
- Seen open, a task is kept in step with the source (title, due, link, `impact`, claims). Seen done, it is finished at the source's time, so the goals that claim it earn for it. Not seen when the pull vouched for everything (`complete`), it has gone and its task is closed undone (`closedAt`).
- A done report only finishes: it never restates the rest of the item.
- A task finished by hand stays finished; one deleted by hand is never made again.
- New work waits while a module's open tasks fill its `maxOpen`, in the order the pull gave it.
- Its `group` and labelled `claims` become claims the goal form offers; `Task.claims` carries them, so goal rules need nothing more.
- A day-only due is due at the end of that day in the person's zone, like every module's.
- Readings are one row per key per day (`ModuleReading`); Readouts shows them all.

The sync loop runs each connector module's pull when it's due; a failure is recorded on the module in plain words and the next wait doubles, up to 12 hours. A refused token marks the connection, and every module that reads through it waits until it's connected again.

**One way out.** Every request goes through `src/lib/connectors/egress.ts`: only the hosts the service names (an address someone typed must resolve to a public one, at every redirect), GET unless the service reads with POST and never a GraphQL mutation, 20 seconds, 8 MB and 60 requests a pull at most. `SIGWALD_CONNECTORS=off` refuses all of it. `src/modules/connect/__tests__/catalog.test.ts` keeps the rules: nothing else under `src/lib/connectors` or a connector module calls `fetch`, every module is beta and off until turned on, every account has a verify, and every service and fixed host is named in `DATAFLOW.md`.

## The marketplace

`/modules` lists every module as a datasheet in catalog order (finished modules first), searchable by name, service and who it's for, narrowed by shelf or to what's on, with the selected module whole in the reading pane. A connector module's pane holds its account, settings, reading state, numbers and what it holds.

## Adding a module

1. Add its id to `ModuleId`, write its manifest, and add it to `MODULES`.
2. Add its tables to `prisma/schema.prisma` with an additive migration.
3. Put its page under `src/app/(common)/` with a layout that wraps it in `ModuleGate`. Make its API routes call `moduleOffResponse` before anything else.
4. Fill the slots and hooks it needs in `client.tsx` and `server.ts`. If it owns tasks, give them their own `source`, list it in `sources`, and set `impact` on them if they have stakes.
5. Add its paths to `OWNED` in the boundary test.
6. If it sends anything out of Sigwald, list it in the manifest's `egress` and in `DATAFLOW.md`.

A connector module needs only its service (`src/lib/connectors/<service>/`), its manifest with `connect`, its pull and its tests: no tables, routes or components of its own. GitHub (`src/modules/github/`) is the reference for a work queue, Linear for a GraphQL service, Stripe for readings, Golden hour for one that reaches nothing.

People (`src/modules/people/`) is a complete small module: a page, its own tables, a job, tasks it owns, and a source goals can claim. Training adds claims per routine (`claimOptions`, `claimKeys`) and draws its own tasks in Focus and the task sheet (`TaskBody`, `TaskPane`). Nutrition owns no tasks at all: a page, its tables and a count in the top bar (`Status`). Work takes data from outside through its own API (a schedule week, a contact roster, `src/modules/work/imports.ts`) and puts its shifts on the calendar through a LOCAL feed per job, which it keeps in step itself (`src/modules/work/feed.ts`), so the calendar and the scheduler see them without knowing the module exists.

A module's tasks that fall on a day (a check-in, a workout) are due at the end of that day in the person's time zone (`endOfDayIn` in `src/lib/date-utils.ts`), the way a Canvas deadline at 11:59 PM is, so they read as that day everywhere and aren't late before it's over.
