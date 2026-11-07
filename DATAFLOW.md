# Where Sigwald's data goes

Sigwald is a personal calendar and task assistant. It runs either as a desktop app on your own machine or as a server you host, and in both cases everything it knows is stored in a Postgres database you control. That database is PGlite inside the desktop app's data folder, or your own Postgres server. Sigwald talks to a handful of outside services to fetch your schedule and coursework, and this file lists every one of them.

This document answers three questions in plain language: what leaves this machine, where it goes, and why. It is written to be read by someone who does not work on the code. It is kept by hand, so a change to how Sigwald talks to the outside world should change this file in the same commit.

Last verified against the code on **2026-11-07**. For the privacy policy that sits on top of this document, see [kaitosoeno.com/sigwald/privacy](https://kaitosoeno.com/sigwald/privacy/) (`site/content/privacy.ts`), which a change here should follow.

---

## The short version

| Where | What Sigwald sends | Can Sigwald change anything there? | Why |
| --- | --- | --- | --- |
| **Canvas** (the address of your school's Canvas, which you enter), only while the School module is on | Your access token, and the address of each page or file it asks for | No, every request is a read | Mirror your courses: assignments, your grades and feedback, announcements, Inbox messages and course materials |
| **Google** (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`) | Event and task titles, notes, locations and times, plus the OAuth tokens that prove it is you | Yes | Two-way Google Calendar and Google Tasks sync |
| **Microsoft** (`login.microsoftonline.com`, `graph.microsoft.com`) | Event and task titles, notes, locations and times, plus the OAuth tokens that prove it is you | Yes | Two-way Outlook Calendar and Microsoft To Do sync |
| **A CalDAV server you choose** (Fastmail, iCloud, Nextcloud) | Event titles, descriptions, locations and times, plus your CalDAV username and password | Yes | Two-way calendar sync |
| **Your DNS resolver, and the domain of an email address you type** (only when Settings, Accounts doesn't recognize the domain) | The domain alone, never the address: DNS lookups for its mail and CalDAV records, then at most two unauthenticated requests to `/.well-known/caldav` on that domain | No | Work out where that address keeps its calendar (`src/lib/calendar-discovery.ts`) |
| **The host of an iCal link you subscribe to** (Google, Outlook, Apple or anyone who publishes one) | A plain request for the link, which carries your IP address | No, it is only read | Show that calendar, read-only |
| **Any calendar app that subscribes to your Sigwald plan link** (Apple Calendar, Google Calendar, Outlook, Thunderbird — you choose) | Your scheduled task titles, notes and times, plus events from Sigwald's own (LOCAL) calendars, when that app polls the private URL | No, it only reads | Show Sigwald's plan in that app |
| **Resend** (`api.resend.com`, self-hosted servers only) | Your email address and a one-time reset link | It sends one email | Password reset |
| **GitHub Releases** (desktop downloads from GitHub only) | A request for the newest release, which carries the app's version, your platform and your IP address | No | Update check |

The Stats, People, Training, Nutrition and Work modules send nothing out of Sigwald, so your goals, the people you keep in touch with, your workouts, what you eat, your shifts and the contacts you keep for each job stay in the database. Work takes a schedule or a contact roster that a script sends to it, and it never calls out to fetch one.

Sigwald has no analytics, no crash reporting, no telemetry and no AI service. This is a fact about the code, because Sigwald ships no analytics library and no language-model client, so nothing you type is sent to a model. The "assistant" behavior (the daily briefing, the focus queue and task ranking) is ordinary arithmetic that runs on your own machine.

The landing page at kaitosoeno.com/sigwald collects nothing, which is covered in [The landing page](#the-landing-page).

Some of Sigwald comes as modules you turn on or off at /modules, and each module's page there lists everything it sends out of Sigwald. Of today's modules only School talks to an outside service (Canvas, below). Stats and People keep everything in the local database.

---

## Canvas

Sigwald asks Canvas for your current courses and your grade in each, their assignment groups and assignments, your own submissions (score, grader comments, rubric marks, and the class statistics when the instructor shares them), quiz settings, course announcements, and the Canvas Inbox threads that were sent in one of your current courses. It also fetches the syllabus, modules, course pages and files. Each request carries only the access token (a Canvas personal access token that you create and paste into Sigwald's settings) and the path of what it wants. No task you write in Sigwald, no note and no personal detail is sent to Canvas, and that includes your email address.

Canvas cannot be changed by Sigwald. The Canvas client only issues GET requests, so there is no code path that creates, edits or deletes anything in Canvas. Marking an assignment complete in Sigwald stays in Sigwald. Reading does not count as a change either: Inbox threads are fetched with `auto_mark_as_read=false`, so Sigwald opening a message never marks it read in Canvas, and the read flags Sigwald shows are copied from Canvas, never written back.

Course materials move toward you. Page text goes into the local database, and files are saved on this computer's disk, in `~/.sigwald/materials` unless `SIGWALD_MATERIALS_DIR` says otherwise. A file is downloaded from the signed link that Canvas hands back for it, and files over 100 MB (adjustable with `SIGWALD_MATERIALS_MAX_FILE_MB`) are listed but not downloaded. When a course stops being current, its database rows are removed and its files stay on disk until you delete them.

Each sync compares what Canvas returns with what it stored last time and records what changed (a new announcement or file, a moved due date, a posted grade, new feedback, work gone missing) as course activity in the local database. That feed is what the School page's Activity view shows. Sigwald itself sends it nowhere. A tool you run on the same machine can read it through Sigwald's API (`/api/sigwald/activity`) and pass it on, for example to a chat app, and whatever it sends is that tool's data flow rather than Sigwald's.

Canvas and CalDAV are also polled in the background, about every 15 minutes by default, and each poll makes the same kinds of requests. Canvas is reached only while the School module is on: turning it off stops every Canvas request, including the background poll, and keeps what was already mirrored in the local database until you delete it.

## Google and Microsoft

These two work the same way, so they share one description. You sign in on the service's own consent screen, and Sigwald is granted access to your calendar and your task list. From then on it can read and write. Sigwald can create, change and delete a calendar event, and do the same for a task in Google Tasks or Microsoft To Do. It cannot create or delete whole calendars or task lists.

When Sigwald writes an event or a task, the content itself travels. That means the title, the description or notes, the location, the start and end times, your time zone and any repeat rule. If you keep something private in the notes of a task that syncs, those notes are stored on Google's or Microsoft's servers.

Sigwald also asks each service for your account's email address once, when you connect it, so it can label the connection in the interface. It does not attach a guest list when it writes an event, so no one else's address is sent. Google and Outlook calendars sync when you use them in the app, and they are not part of the background poll.

Google and Microsoft each need an OAuth app, which is what their consent screen names. Where Sigwald runs on your own computer (the desktop app, or a server you reach at localhost), it signs in through Sigwald's own apps, registered by Sigwald's maintainer. Sign-in goes straight from your browser to Google or Microsoft and back to your own machine: the code comes back to a loopback address, and your machine trades it for tokens with the service directly. No server of Sigwald's sits in between or ever sees a token, and the maintainer's registration gives no access to your account. Those apps can't send anyone back to a server at its own domain, so a self-hosted server registers its own app and gives Sigwald its client ID and secret, which are stored encrypted, like the tokens. Either way, the sign-in carries a one-time `state` and a PKCE challenge (`src/lib/oauth/`), so a callback Sigwald didn't start is refused, and on a server the browser that comes back must be signed in as the user who started it, so nobody can get another user's calendar attached to their own account.

## A CalDAV server

CalDAV is the open standard behind Fastmail, iCloud Calendar and others. You supply the server address, a username and a password. Sigwald reads your calendars and writes to them, and what travels is a standard calendar file with the event's title, description, location, times and repeat rules.

CalDAV uses a username and password on every request instead of a revocable token, so that password is held on this machine and sent over HTTPS each time Sigwald syncs. If you did not supply a separate username, Sigwald falls back to your email address as the username, which means that address goes to the CalDAV provider you chose and already have an account with.

## An iCal link

A calendar's iCal link is a web address for one file that lists its events. Google, Outlook and Apple publish one for any calendar, and so do schools, teams and sports leagues. When you subscribe, Sigwald requests that file, saves its events, and requests it again every 15 minutes. Nothing is sent back: the request carries no account, no token and none of your data, only what any request carries, such as your IP address. All of it goes through `src/lib/ical-feed.ts`.

Sigwald only requests public addresses. It refuses an address on your own machine or your local network, checks every redirect the same way, gives up after 15 seconds and stops reading past 10 MB, so a link can't make Sigwald reach into a network it sits on.

Google's "secret address" works like a password for reading that calendar: anyone who has it can read it. Sigwald keeps the link in its database with the calendar's other details, which is not encrypted the way stored credentials are (see Known gaps).

## Your Sigwald plan link (iCal out)

From Settings → Calendar you can create a private URL that any calendar app can subscribe to. That app polls Sigwald and receives a standard calendar file built in `src/lib/ical-out.ts`: your auto-scheduled tasks (title, description and scheduled times) and events from Sigwald-owned LOCAL calendars such as Work module shifts. Google, Outlook, CalDAV and subscribed iCal events are not included — those already live in their own calendars.

The URL holds a secret token. Anyone who has the link can read that feed, the same way Google's "secret address" works. Sigwald stores only a SHA-256 hash of the token, shows the raw token once when you create or replace the link, and never logs it. Replacing the link makes the old URL stop working; turning it off deletes the row. The feed is public to whoever has the URL (no sign-in): calendar apps cannot use your Sigwald session.

## Resend

The only email Sigwald sends is a password reset. When you ask for one, Sigwald asks Resend to deliver a message to your email address with a link that holds a one-time reset token. This runs only on a self-hosted server that has a Resend API key (`RESEND_API_KEY`) and a sender address (`EMAIL_FROM`) set. With the key but no address, the server logs an error and sends nothing. The desktop app signs you in with a token that is made on each launch, so it has no password reset and sends no email.

## Your data

From Settings → Data you can download everything you own in Sigwald as one file. That file goes only to your browser — Sigwald does not send it anywhere else — and it holds your tasks, goals, courses, shifts, people, training, nutrition and settings, but not passwords or connected-account tokens. Importing the same kind of file, or erasing the account under that tab, also stays on this machine.

---

## What never leaves this machine

- Your task list, notes and due dates, unless a task is synced to Google or Microsoft, or you have turned on the plan subscription link (in which case scheduled tasks' titles, notes and times go to whatever calendar app polls that URL).
- Everything Sigwald works out about you, which is the focus queue, the daily briefing, task rankings, skip history, XP and goal progress. All of it is computed locally.
- Your goals. An install can also project goals in from a local vault through Sigwald's goals API, and that flow only ever comes inward.
- Logs. Sigwald writes its logs to a table in the local database and to a file on disk.
- Fonts. They are bundled when the app is built, so neither the desktop app nor a self-hosted server asks a font service for anything at run time.

---

## Desktop app and self-hosted server

Both run the same server code, and they differ in where it lives and what is switched on.

| | Desktop app | Self-hosted server |
| --- | --- | --- |
| Database | PGlite in the app's data folder, with no network port | Your own Postgres (Docker Compose starts one) |
| Who can reach it | The loopback interface only, signed in with a token made on each launch | Whoever can reach the port you expose, with accounts and passwords |
| Background sync | A timer inside the app | A timer in the worker process, or inside the app when `SIGWALD_SCHEDULER=inprocess` |
| Where the encryption key comes from | Made on first launch and sealed by the operating system | `SIGWALD_SECRET_KEY` in your environment |
| Update check | Yes for GitHub downloads, none for store and package-manager builds | None, you update the image |
| Password reset email | None | Through Resend, if you configure it |
| Backups | Copies of the database in the app's data folder, made daily, before migrations and on request. They never leave the machine. | None of its own. Back up your Postgres yourself. |

In the desktop app, the database never listens on the network. The app's server reaches it over a Unix socket in the data folder (readable only by your user) on macOS and Linux, and over the loopback interface on Windows. Before a schema update, the app saves a copy of the database in a `backups` folder beside it and keeps the last five.

The update check applies to the macOS disk image, the Windows installer and the AppImage, which are also what Homebrew and winget install. These ask GitHub Releases for the newest version when the app launches, and GitHub sees the request along with your IP address. Builds from the Mac App Store, the Microsoft Store, Snap and the Linux packages (.deb, .rpm, the AUR) make no such request, because their store or package manager updates them.

Nothing reports back. There are no analytics, no crash reports and no telemetry in either mode.

---

## The landing page

The page at kaitosoeno.com/sigwald (the code is in `site/`) is a static site served as files by a Cloudflare Worker. It has no forms, no cookies, no analytics or tracking script and no third-party requests, and its fonts are bundled at build time. The one inline script handles a page transition when you arrive from the portfolio and stores nothing. As with any website, Cloudflare, which hosts it, sees the ordinary details of a request such as your IP address and browser.

---

## Where the keys are kept

All credentials live in the local database, and each is encrypted before it is written. That covers the Google and Microsoft OAuth tokens, your Canvas token, your CalDAV password, the Google and Microsoft client secrets, and the Resend API key. Each value is sealed with AES-256-GCM using a key held outside the database (`SIGWALD_SECRET_KEY` on a server). Authenticated encryption means a value altered in the database refuses to decrypt instead of quietly turning into a broken credential that then gets sent to a provider.

This protects a copy of the database, such as a `pg_dump`, a Time Machine snapshot or a stray backup, which is the realistic way these values would escape. It does not protect against anything running as you on this machine, because that process can read the key from the environment as easily as the database. On a server install, closing that gap means moving the key into the operating system's secret store, which is not done yet.

In the desktop app, the credential key and the session signing key are generated randomly on first launch and sealed with Electron's safeStorage, which uses the macOS Keychain, Windows DPAPI or the Linux secret service. On a Linux desktop with no secret service, and in the macOS builds that Apple hasn't signed yet, they are written to a file in the app's data folder that only your user can read. The first signed macOS build moves them into the Keychain.

If you lose the key, every stored credential becomes unreadable and you have to reconnect each integration. If you change the key, the stored values have to be re-encrypted while the old key is still available (`npm run credentials:encrypt`).

Your own login password is stored only as a bcrypt hash in its own column on your user record. A hash cannot be turned back into the password, so there is nothing there to encrypt.

When a CalDAV connection succeeds or fails, the server address and username are written to the local log table. No password is logged, but those two values appear in the log, which is not encrypted. Because that log is not encrypted and the server also prints entries to a file on disk, credentials are stripped on the way in. Anything that looks like a credential is replaced with `[redacted]` before it is written, whether it arrives as a named field, inside text that a caller already flattened, or as an authorization header in a message. Sync markers such as the change tag are left readable, since blanking them would make sync problems much harder to diagnose.

---

## Known gaps

These are kept here so they are not rediscovered later.

- **External calls do not all go through one module per service.** Canvas goes through `src/lib/canvas/canvas-client.ts` and CalDAV through `src/lib/caldav/client.ts`. Google reaches out from several places (`google-calendar.ts`, `google.ts`, the Google task provider, the token manager and the `calendar/google` routes), Microsoft the same way (`outlook-calendar.ts`, `outlook-sync.ts`, `outlook-utils.ts`, the Outlook task provider, the token manager and the Outlook routes), and email from one module (`email-service.ts`). This makes "what exactly do we send?" harder to answer for those services than it should be, which is the reason the rule exists.
- **Logging is disabled but the batch path writes anyway.** There is no settings row, so the configured level is "none". The single-entry path respects that, but the batch path, which is where logs sent from the browser land, writes every entry regardless. Logging is therefore not fully off.
- **iCal links are stored unencrypted.** A Google secret address lets whoever has it read that calendar, so it is close to a credential, but it sits in `CalendarFeed.url` beside every other feed's address, and that column is not one of the encrypted fields. Encrypting it means encrypting the column for every feed type, with a backfill that ships with the reader.
- **Dormant webhook fields.** The database has columns for registering a Google Calendar push channel, but no code registers one, so Google never calls in.
