# Changelog

Sigwald's changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). History from before the fork is in [FluidCalendar's changelog](https://github.com/dotnetfactory/fluid-calendar/blob/main/CHANGELOG.md).

## [Unreleased]

### Added

- **The marketplace:** `/modules` lists every module on a shelf (Engineering, Projects, Design & media, Writing, Research, Clients, Money & hours, Learning, Health, People & career, Calendar & place, Bring your own), searchable by name, service and who it's for, with the selected module's account, settings, reads and holdings in its pane. Every new module is in beta and off until you turn it on.
- **Connector modules** (`src/modules/connect`): a module that reads another service declares the service, what it makes (tasks, calendar events, daily numbers) and its settings as plain data, and supplies one pull. Sigwald keeps the connection (checked with the service before it's kept, encrypted at rest), reads it on a schedule with backoff, finishes a task when the work is done at the source (so goals earn for it), closes one that's gone undone, never makes again a task you deleted, and holds new work back past a per-module limit. Migration `20261111120000_connector_modules`.
- **One way out:** every connector request goes through `src/lib/connectors/egress.ts`, which allows only the hosts a service names, GET unless the service reads with POST (never a GraphQL mutation), public addresses only for anything typed in (checked at each redirect), and caps time, size and requests. `SIGWALD_CONNECTORS=off` refuses all of them.
- **Modules on it, by shelf:**
  - Goals & numbers: Readouts, Plausible.
  - Engineering: GitHub, GitLab, Linear, Jira, Sentry, PagerDuty, UptimeRobot.
  - Projects: Asana, ClickUp, Trello, Todoist, Notion databases, Airtable.
  - Design & media: Figma comments, YouTube, Transistor, Patreon, Unsplash, Bluesky, Hacker News mentions.
  - Writing: Ghost, WordPress (self-hosted), beehiiv, Kit.
  - Research: Zotero, Readwise Reader, arXiv, Feeds (RSS and Atom), Semantic Scholar, Federal Register comment periods.
  - Clients: HubSpot, Pipedrive, Calendly, Cal.com, Zendesk.
  - Money & hours: Stripe, Lemon Squeezy, Harvest, Toggl Track, Clockify, YNAB.
  - Learning: Moodle, WaniKani, Codeforces.
  - Health: Intervals.icu.
  - People & career: Job boards (Greenhouse, Lever, Ashby).
  - Calendar & place: Deadline feed (any iCal link of due dates), Golden hour, Holidays, Weather.
  - Bring your own: Inbox, Spreadsheet (any published CSV).
- **Readouts:** one page of every number the modules read, with its change over a day, a week and a month.
- **Inbox:** a private address that Zapier, Make, n8n, a shortcut or a script can POST work to. Only a fingerprint of the address is stored, and erasing your data removes it.

## [1.0.0] - 2026-10-31

Sigwald reads your calendar, your Canvas courses and your goals, then tells you the one thing to do next.

### Changed

- **Renamed from Erwin to Sigwald**, before the first release. The app, the packages, the repository (`pockanoodles/sigwald`), the image (`ghcr.io/pockanoodles/sigwald`) and the `SIGWALD_*` settings all carry the new name. `/api/erwin/*` and each Focus task's `erwin` field are gone.

### Added

- **Focus:** a ranked queue of what to do next, a daily briefing, and a three-column desk with the work in the middle. Done, Skip and Later work from the keyboard.
- **Canvas sync:** courses, assignments, modules and files come in read-only, and the files are saved on your machine so doing the work does not start with a Canvas login.
- **Gradebook:** every assignment with your score, the class statistics when shared, grader comments, rubric marks and quiz rules (time limit, attempts, LockDown Browser), plus Canvas's course totals, an estimate where a course hides them, and what each letter takes on the remaining work. Migration `20261022220000_canvas_gradebook`.
- **Announcements and Canvas Inbox:** kept in full and readable in Sigwald. Inbox threads are fetched without marking them read.
- **Activity:** each sync records what changed (new announcements, messages, files and assignments, moved due dates, posted grades, feedback, work gone missing) in one feed, with an unseen count in the top bar. `GET /api/sigwald/activity?since=` lets a local tool follow it.
- **Canvas corrections:** say where Canvas is wrong, as one field and what's true instead: a teammate handed in the group copy (`state`), or every Connect SmartBook in a course closes at noon (`dueAt` `setTime 12:00`, a rule matched by name or submission type). Sync lays them over Canvas everywhere (tasks, Focus, activity, grades), keeps what Canvas said beside each one, and retires a one-assignment correction when Canvas changes that answer, with a feed item saying so. `GET/POST/DELETE /api/sigwald/corrections`. Migration `20261027120000_canvas_corrections`.
- **Courses page:** Activity, Grades, News and Library views, with an All tab beside the course tabs.
- **Goals and progress:** goals link to tasks and courses, and progress shows honest numbers with no streaks.
- **Ladder:** the goals page is a character sheet for the two-month hex. It shows the eight stats with levels and the XP each hex added, the hex's days with the work finished on each and its bosses, the goals behind each stat, and a log of what earned the XP. XP is derived from finished tasks on every read and never stored. `GET /api/sigwald/ladder?year=&index=`.
- **Goal claims:** a goal made in Sigwald can claim all of Canvas, one course or a project from the Ladder, and every task from there files under it on its own, finished ones included, so XP works without linking tasks one by one.
- **Boss proof:** a boss can name a Canvas gradebook item or another task as its proof. Handing the work in, a grade or an excusal fells it, the item's due date becomes its date, and the Ladder says what proved it ("Graded 90 / 100"). The boss form suggests the Canvas item a boss looks like, and a boss with no proof has a Done box. `GET /api/sigwald/goals/sources` lists what can be claimed and proved. Migration `20261025040000_boss_proof`.
- **XP report:** `GET /api/sigwald/xp?from=&to=` gives the XP a span of days added and all XP through its last day, per stat, with the goals, unlinked work and felled bosses behind it, so a local tool can report on XP without working it out again.
- **Calendar and tasks:** Google, Outlook and CalDAV calendars, task sync with Outlook and Google Tasks, auto-scheduling, subtasks, and deferred tasks.
- **Add a calendar by where it lives:** enter an email and Sigwald finds the way in, pick a provider tile, or paste a link. A custom domain's CalDAV server is found through its well-known address. Google and Outlook can sign in through Sigwald's own apps with PKCE, which this release ships without, so they fall back to an app under System. Migration `20261030120000_oauth_apps`.
- **iCal links:** subscribe to any calendar by its iCal address (Google's secret address, Outlook's published ICS link, an Apple public calendar), read-only, refreshed with the background sync. It's how Google and Outlook calendars reach the desktop app. Sigwald fetches only public addresses, checks each redirect, and caps the time and size of a read. Repeating events keep their time zone across daylight saving, a moved occurrence shows once at its new time, and cancelled events stay off. Ported from FluidCalendar (dotnetfactory/fluid-calendar#212).
- **Desktop app:** Electron around the same server, with an embedded database and no account or setup. It backs up the database once a day while it's open, before any migration that changes it, and on Back up now, and Settings restores any copy by restarting into it, keeping the database it replaced.
- **Self-host:** Docker Compose with Postgres and a background sync worker, or a single container with the in-process scheduler.
- **`npm run dev:local`:** the app on an embedded database with nothing else installed, and `--seed demo` for an example week. It listens on loopback only; `--lan` opens it to a phone on the same Wi-Fi or tailnet and prints the phone's sign-in link.
- **Phone layout:** a bottom bar on phones (Today, Focus, Calendar, Tasks, your first module, More), swipe a row right for Done and left for Later, Skip or Focus, Calendar opens on Day and swipes between periods, and Focus pins Done / Skip / Later under the thumb. Safe areas, 16px inputs so iOS doesn't zoom, and dialogs that fit a 393px screen.
- **Landing page:** kaitosoeno.com/sigwald in English and Japanese.
- **Brand module:** the product name, URLs and support contact live in `src/lib/brand.ts`.
- **CI:** every pull request and push to `main` runs the types, lint and unit tests, the desktop shell's types, and a production build with no secrets set (`.github/workflows/ci.yml`).
- **Package managers publish themselves:** publishing a release pushes the Homebrew cask, the AUR package and the winget manifests, and releases that version's snap from edge to stable (`.github/workflows/channels.yml`). Each channel waits for its secret.
- **Build provenance:** every release file and every server image carries a signed attestation of the workflow run that built it (`gh attestation verify`).

### Changed

- Default module labels in the rail and catalog: Ladder is **Stats**, Courses is **School**, Work stays Work. Routes and module ids are unchanged.
- Settings opens as a normal page from the rail (no popup). Theme and sign-out live under User. The page uses the field-kit side index and section plates instead of card chrome.
- Window resize on Stats (and the nav rail) eases on the brand curve: day-track labels fade by measured density before they collide, and layout gaps soften instead of snapping.
- `PATCH /api/system-settings` accepts only the real settings fields and answers 400 for a bad value, instead of passing the request body to the database.
- Password reset email sends from the address in `EMAIL_FROM`. With `RESEND_API_KEY` set and no `EMAIL_FROM`, the server logs an error and sends nothing.
- Docker Compose needs `POSTGRES_PASSWORD`, has no default password, and publishes Postgres and Redis on 127.0.0.1 only. The default database user and name are now `sigwald`.
- The background worker moved from `src/saas/jobs` to `src/worker`.
- Background sync runs on a plain timer in the worker process (or inside the app with `SIGWALD_SCHEDULER=inprocess`). The worker no longer uses BullMQ, so Redis is gone from Docker Compose and from the requirements.
- Canvas syncs every 15 minutes instead of every 2 hours. Materials sync incrementally each time, with a full pass every 6 hours.
- Canvas creates a task for every assignment with something to hand in or a date to meet, including work graded before Sigwald first saw it and assignments that unlock later. Undated participation lines and posted-grade placeholders stay in the gradebook only, and assignments Canvas removes are removed.
- Canvas work that's closed without a submission (`missed`), or that happens in class or in another tool once its date passes (`ended`), leaves Focus and the attention list instead of staying overdue.
- Focus's "if you miss this" projection reads the stored gradebook, weights groups the way Canvas's current score does, and no longer calls Canvas while the page loads.
- The goals map is gone, and with it `@xyflow/react` and `@dagrejs/dagre`. Goals and bosses made in Sigwald are added and edited from the Ladder, and tasks are still linked to goals from Tasks.
- A new hex starts with the Build of the hex before it, so a season that spans two hexes keeps its Build.
- A vault-bound boss is settled by its Canvas gradebook item, not only by an item with a task, so an in-class exam falls when its grade posts. The projection names the Canvas item an unbound boss looks like (`suggestedBindings`).
- A goal the projection leaves out is set aside (`dropped`) instead of deleted, so its finished work keeps its XP and it returns if the vault brings it back. A goal that is done or set aside files no new work and no longer lifts its tasks in Focus, while its finished tasks keep their links. Tasks and the Ladder leave set-aside goals out, unless the Ladder's hex shows XP they earned.
- Goals from the vault can't be edited or deleted through `PUT`/`DELETE /api/sigwald/goals/[id]` (409), since the next projection would undo it.
- The goal projection (`POST /api/sigwald/goals/project`) can carry the Build. The running hex then takes it and shows it read-only, a change to it through `PUT /api/sigwald/cycles/[id]` answers 409, and the hex's theme still edits in Sigwald. A projection without one makes the Build editable again. Migration `20261024230000_projected_build`.
- The Mac App Store and the Microsoft Store are off the install list until people ask for them. Their release jobs stay and wait for their secrets.
- An ad-hoc signed macOS build turns its in-app updater off, because Squirrel.Mac can't update it. The Homebrew cask clears the quarantine flag on the app it checked and leaves updates to `brew upgrade` until releases are notarized.

### Fixed

- **Repeating CalDAV events across daylight saving:** a series expanded with rrule from its UTC start, so a weekly 9:00 event showed at 8:00 once daylight saving ended, and an EXDATE'd occurrence still showed. Series now expand from their own VEVENT in their own time zone (`src/lib/ical-recurrence.ts`), shared with iCal links.
- The background worker resolved `@/` imports one directory too high after it moved to `src/worker`, so a fresh build crashed on start.
- A 15-minute sync interval on a 15-minute tick skipped every other tick.
- BullMQ's job scheduler could stop scheduling for good after a worker restart that landed within one interval of the last run, which ended background sync without an error.
- Unit tests used the database named in `.env`, and the logger wrote test errors into its `Log` table. `jest.setup.js` now points Prisma at no database and stubs the logger.
- Part of a Canvas sync could fail while the sync looked healthy: a course's materials pass, the announcements or Inbox read, or a course's submissions or quiz list. The materials failure was only logged, and the rest only as warnings, which the default log level drops. Each now lands in the Canvas provider's error, which the Courses top bar shows and a health check can watch. A page a course hides from students (Canvas's 404 "disabled for this course") doesn't count, and a failed submissions or quiz read no longer blanks the feedback and quiz rules already stored.
- A task done in Google Tasks came into Sigwald with no `completedAt`: the field mapper read `completed` while the provider hands tasks over as `completedDate`, and a new task's import left the field out. The provider tests that expected Google's `due` to land in `startDate` described a policy upstream dropped, and now test `due` as the due date.

### Removed

- The `bullmq`, `ioredis` and `cron` dependencies, the Redis service in Docker Compose and `REDIS_URL`.

- The hosted-service code inherited from upstream: the `.open` and `.saas` file split, the feature flags, the waitlist and beta settings, the lifetime-access banner and the queue-based auto-schedule path.
- The SQLite import script (`migrate.js`) and the second Resend module.
- The Resend API key field in System settings, which nothing read, and the Daily Email Updates toggle, which promised an email nothing sends.
- The database tables and columns behind them, in migration `20261014120000_drop_upstream_saas`: `PendingWaitlist`, `Waitlist`, `BetaSettings`, `JobRecord`, `Subscription`, `SystemSettings.resendApiKey` and `NotificationSettings.dailyEmailEnabled`.
