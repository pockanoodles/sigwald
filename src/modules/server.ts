/**
 * What each module adds to the server's side of the core (server only: these
 * import Prisma). The core reads this list and never imports a module's
 * server code itself.
 */
import type { Db, DbTransaction } from "@/lib/prisma";
import type { SearchGroup, SearchQuery } from "@/lib/search/types";
import type { RankSignals } from "@/lib/sigwald/rank-stage1";

import { pullAirtable } from "@/modules/airtable/pull";
import { pullArxiv } from "@/modules/arxiv/pull";
import { pullAsana } from "@/modules/asana/pull";
import { pullBeehiiv } from "@/modules/beehiiv/pull";
import { pullBluesky } from "@/modules/bluesky/pull";
import { pullClickup } from "@/modules/clickup/pull";
import { pullClockify } from "@/modules/clockify/pull";
import { codeClaimKeys, codeClaimOptions } from "@/modules/code/facts";
import { pullCodeforces } from "@/modules/codeforces/pull";
import type { PullFn } from "@/modules/connect/pull";
import { connectorServer } from "@/modules/connect/server";
import {
  courseClaimKeys,
  courseClaimOptions,
  courseRankSignals,
  courseTaskFacts,
} from "@/modules/courses/facts";
import { courseProofItems } from "@/modules/courses/proof";
import { searchCourses } from "@/modules/courses/search";
import { syncCanvasIfDue } from "@/modules/courses/server";
import { pullDaylight } from "@/modules/daylight/pull";
import { pullDeadlines } from "@/modules/deadlines/pull";
import { pullFedreg } from "@/modules/fedreg/pull";
import { pullFeeds } from "@/modules/feeds/pull";
import { pullFigma } from "@/modules/figma/pull";
import { pullGhost } from "@/modules/ghost/pull";
import { pullGithub } from "@/modules/github/pull";
import { pullGitlab } from "@/modules/gitlab/pull";
import { pullHackernews } from "@/modules/hackernews/pull";
import { pullHarvest } from "@/modules/harvest/pull";
import { pullHolidays } from "@/modules/holidays/pull";
import { pullInbox } from "@/modules/inbox/pull";
import { pullJira } from "@/modules/jira/pull";
import { pullJobs } from "@/modules/jobs/pull";
import { pullKit } from "@/modules/kit/pull";
import { goalRankSignals, goalTaskFacts } from "@/modules/ladder/facts";
import { searchGoals } from "@/modules/ladder/search";
import { linkChangedTasksToGoals } from "@/modules/ladder/server";
import { pullLemonSqueezy } from "@/modules/lemonsqueezy/pull";
import { pullLinear } from "@/modules/linear/pull";
import { pullNotion } from "@/modules/notion/pull";
import { pullPagerduty } from "@/modules/pagerduty/pull";
import { reconcileReachOuts } from "@/modules/people/reach-out";
import { searchPeople } from "@/modules/people/search";
import { pullScholar } from "@/modules/scholar/pull";
import { pullSentry } from "@/modules/sentry/pull";
import { pullSheet } from "@/modules/sheet/pull";
import { pullStripe } from "@/modules/stripe/pull";
import { pullTodoist } from "@/modules/todoist/pull";
import { pullToggl } from "@/modules/toggl/pull";
import {
  routineClaimKeys,
  routineClaimOptions,
} from "@/modules/training/facts";
import { searchRoutines } from "@/modules/training/search";
import { reconcileWorkouts } from "@/modules/training/workout";
import { pullTrello } from "@/modules/trello/pull";
import type { ClaimOption, ModuleId, ProofItem } from "@/modules/types";
import { pullWeather } from "@/modules/weather/pull";
import { pullWordpress } from "@/modules/wordpress/pull";
import { restoreShiftEvents } from "@/modules/work/feed";
import { searchWork } from "@/modules/work/search";
import { reconcileTimesheets } from "@/modules/work/timesheet";
import { pullYnab } from "@/modules/ynab/pull";

export interface ModuleJob {
  /** Names it in logs. */
  id: string;
  /** One person's pass. It runs every sync tick, so it must be cheap when there's nothing to do. */
  run: (userId: string) => Promise<unknown>;
}

/** A task the core is about to hand out, and what Focus made of it. */
export interface FactsRequest {
  id: string;
  /** Focus judged it DANGER, which earns the costlier facts (Courses: the grade if it's missed). */
  danger?: boolean;
}

/**
 * Fields a module adds to one task, spread onto it wherever the core hands
 * tasks out. The core never reads them; each module documents its own.
 */
export type TaskFacts = Record<string, unknown>;

export interface ServerContributions {
  /** Work the background sync loop runs for everyone who has the module on. */
  jobs?: ModuleJob[];
  /** Hears `tasksChanged` (src/modules/hooks.ts), on or off. */
  afterTasksChange?: (
    db: Db | DbTransaction,
    userId: string,
    taskIds?: string[]
  ) => Promise<void>;
  /** What it adds to tasks in the task list, the Focus queue and the briefing. Asked only while it's on. */
  taskFacts?: (
    db: Db,
    userId: string,
    tasks: FactsRequest[]
  ) => Promise<Map<string, TaskFacts>>;
  /**
   * What it tells Focus's ranking about tasks: a lift for work it doesn't own
   * (Ladder's goals), stakes for its own (Courses' points). Asked only while
   * it's on.
   */
  rankSignals?: (
    db: Db,
    userId: string,
    taskIds: string[]
  ) => Promise<Map<string, RankSignals>>;
  /** What it keeps that a boss can name as proof: these refs, or all. On or off. */
  proofItems?: (
    db: Db | DbTransaction,
    userId: string,
    refs?: string[]
  ) => Promise<ProofItem[]>;
  /** The claims it offers goals, for the goal form and to check a claim. On or off. */
  claimOptions?: (db: Db, userId: string) => Promise<ClaimOption[]>;
  /** Keys a goal can claim tasks by beyond source and project ("course:<id>"), on or off. */
  claimKeys?: (
    db: Db | DbTransaction,
    userId: string,
    taskIds: string[]
  ) => Promise<Map<string, string[]>>;
  /**
   * What the top bar's search finds among what it keeps: a group per kind of
   * thing, each hit linking to its page opened on it. Asked only while it's on.
   */
  search?: (db: Db, userId: string, q: SearchQuery) => Promise<SearchGroup[]>;
  /**
   * A connector module's read of the outside (src/modules/connect): its job
   * runs it when it's due, and "Pull now" runs it at once. Made by
   * `connectorServer`, never written by hand.
   */
  connector?: { pull: PullFn };
}

export const SERVER_MODULES: Record<ModuleId, ServerContributions> = {
  courses: {
    jobs: [{ id: "courses.canvas-sync", run: syncCanvasIfDue }],
    taskFacts: courseTaskFacts,
    rankSignals: courseRankSignals,
    claimKeys: courseClaimKeys,
    claimOptions: courseClaimOptions,
    proofItems: courseProofItems,
    search: searchCourses,
  },
  ladder: {
    afterTasksChange: linkChangedTasksToGoals,
    taskFacts: goalTaskFacts,
    rankSignals: goalRankSignals,
    search: searchGoals,
  },
  people: {
    jobs: [{ id: "people.reconcile", run: reconcileReachOuts }],
    search: searchPeople,
  },
  training: {
    jobs: [{ id: "training.reconcile", run: reconcileWorkouts }],
    claimKeys: routineClaimKeys,
    claimOptions: routineClaimOptions,
    search: searchRoutines,
  },
  // Nutrition keeps to its own page and the top bar: nothing on the server's side.
  nutrition: {},
  work: {
    jobs: [
      { id: "work.timesheets", run: reconcileTimesheets },
      { id: "work.calendar", run: restoreShiftEvents },
    ],
    search: searchWork,
  },
  // Code's days arrive through its import API; it adds only what goals claim by.
  code: {
    claimKeys: codeClaimKeys,
    claimOptions: codeClaimOptions,
  },
  // Connector modules (src/modules/connect): each is its pull.
  github: connectorServer("github", pullGithub),
  linear: connectorServer("linear", pullLinear),
  stripe: connectorServer("stripe", pullStripe),
  daylight: connectorServer("daylight", pullDaylight),
  inbox: connectorServer("inbox", pullInbox),
  // Readouts reads the readings the connector modules keep; nothing of its own on the server.
  readouts: {},
  deadlines: connectorServer("deadlines", pullDeadlines),
  sheet: connectorServer("sheet", pullSheet),
  holidays: connectorServer("holidays", pullHolidays),
  weather: connectorServer("weather", pullWeather),
  jobs: connectorServer("jobs", pullJobs),
  arxiv: connectorServer("arxiv", pullArxiv),
  feeds: connectorServer("feeds", pullFeeds),
  fedreg: connectorServer("fedreg", pullFedreg),
  scholar: connectorServer("scholar", pullScholar),
  codeforces: connectorServer("codeforces", pullCodeforces),
  bluesky: connectorServer("bluesky", pullBluesky),
  hackernews: connectorServer("hackernews", pullHackernews),
  gitlab: connectorServer("gitlab", pullGitlab),
  jira: connectorServer("jira", pullJira),
  sentry: connectorServer("sentry", pullSentry),
  pagerduty: connectorServer("pagerduty", pullPagerduty),
  asana: connectorServer("asana", pullAsana),
  clickup: connectorServer("clickup", pullClickup),
  trello: connectorServer("trello", pullTrello),
  todoist: connectorServer("todoist", pullTodoist),
  notion: connectorServer("notion", pullNotion),
  airtable: connectorServer("airtable", pullAirtable),
  figma: connectorServer("figma", pullFigma),
  ghost: connectorServer("ghost", pullGhost),
  wordpress: connectorServer("wordpress", pullWordpress),
  beehiiv: connectorServer("beehiiv", pullBeehiiv),
  kit: connectorServer("kit", pullKit),
  harvest: connectorServer("harvest", pullHarvest),
  toggl: connectorServer("toggl", pullToggl),
  clockify: connectorServer("clockify", pullClockify),
  ynab: connectorServer("ynab", pullYnab),
  lemonsqueezy: connectorServer("lemonsqueezy", pullLemonSqueezy),
};
