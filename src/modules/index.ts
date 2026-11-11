import airtable from "@/modules/airtable/manifest";
import arxiv from "@/modules/arxiv/manifest";
import asana from "@/modules/asana/manifest";
import beehiiv from "@/modules/beehiiv/manifest";
import bluesky from "@/modules/bluesky/manifest";
import calcom from "@/modules/calcom/manifest";
import calendly from "@/modules/calendly/manifest";
import clickup from "@/modules/clickup/manifest";
import clockify from "@/modules/clockify/manifest";
import code from "@/modules/code/manifest";
import codeforces from "@/modules/codeforces/manifest";
import courses from "@/modules/courses/manifest";
import daylight from "@/modules/daylight/manifest";
import deadlines from "@/modules/deadlines/manifest";
import fedreg from "@/modules/fedreg/manifest";
import feeds from "@/modules/feeds/manifest";
import figma from "@/modules/figma/manifest";
import ghost from "@/modules/ghost/manifest";
import github from "@/modules/github/manifest";
import gitlab from "@/modules/gitlab/manifest";
import hackernews from "@/modules/hackernews/manifest";
import harvest from "@/modules/harvest/manifest";
import holidays from "@/modules/holidays/manifest";
import hubspot from "@/modules/hubspot/manifest";
import inbox from "@/modules/inbox/manifest";
import intervals from "@/modules/intervals/manifest";
import jira from "@/modules/jira/manifest";
import jobs from "@/modules/jobs/manifest";
import kit from "@/modules/kit/manifest";
import ladder from "@/modules/ladder/manifest";
import lemonsqueezy from "@/modules/lemonsqueezy/manifest";
import linear from "@/modules/linear/manifest";
import moodle from "@/modules/moodle/manifest";
import notion from "@/modules/notion/manifest";
import nutrition from "@/modules/nutrition/manifest";
import pagerduty from "@/modules/pagerduty/manifest";
import patreon from "@/modules/patreon/manifest";
import people from "@/modules/people/manifest";
import pipedrive from "@/modules/pipedrive/manifest";
import plausible from "@/modules/plausible/manifest";
import readouts from "@/modules/readouts/manifest";
import readwise from "@/modules/readwise/manifest";
import scholar from "@/modules/scholar/manifest";
import sentry from "@/modules/sentry/manifest";
import sheet from "@/modules/sheet/manifest";
import stripe from "@/modules/stripe/manifest";
import todoist from "@/modules/todoist/manifest";
import toggl from "@/modules/toggl/manifest";
import training from "@/modules/training/manifest";
import transistor from "@/modules/transistor/manifest";
import trello from "@/modules/trello/manifest";
import type {
  ClaimOption,
  ModuleId,
  ModuleManifest,
  ModuleState,
} from "@/modules/types";
import unsplash from "@/modules/unsplash/manifest";
import uptimerobot from "@/modules/uptimerobot/manifest";
import wanikani from "@/modules/wanikani/manifest";
import weather from "@/modules/weather/manifest";
import wordpress from "@/modules/wordpress/manifest";
import work from "@/modules/work/manifest";
import ynab from "@/modules/ynab/manifest";
import youtube from "@/modules/youtube/manifest";
import zendesk from "@/modules/zendesk/manifest";
import zotero from "@/modules/zotero/manifest";

/**
 * Every module this build ships, in catalog order: finished modules first,
 * then the ones still in beta. Plain data, so the rail, the server and
 * middleware can all import it. A module someone has never touched takes its
 * place in the rail from this order.
 */
export const MODULES: readonly ModuleManifest[] = [
  ladder,
  work,
  courses,
  people,
  training,
  nutrition,
  code,
  readouts,
  plausible,
  github,
  gitlab,
  linear,
  jira,
  sentry,
  pagerduty,
  uptimerobot,
  asana,
  clickup,
  trello,
  todoist,
  notion,
  airtable,
  figma,
  youtube,
  transistor,
  patreon,
  unsplash,
  bluesky,
  hackernews,
  ghost,
  wordpress,
  beehiiv,
  kit,
  zotero,
  readwise,
  arxiv,
  feeds,
  scholar,
  fedreg,
  hubspot,
  pipedrive,
  calendly,
  calcom,
  zendesk,
  stripe,
  lemonsqueezy,
  harvest,
  toggl,
  clockify,
  ynab,
  moodle,
  wanikani,
  codeforces,
  intervals,
  jobs,
  deadlines,
  daylight,
  holidays,
  weather,
  inbox,
  sheet,
];

export function isModuleId(id: string): id is ModuleId {
  return MODULES.some((m) => m.id === id);
}

export function moduleById(id: ModuleId): ModuleManifest {
  const found = MODULES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown module: ${id}`);
  return found;
}

/** The module whose rail entry is this path, if any. */
export function moduleForPath(pathname: string): ModuleManifest | undefined {
  return MODULES.find(
    (m) =>
      m.page &&
      (pathname === m.page.href || pathname.startsWith(`${m.page.href}/`))
  );
}

/** The module that owns a task source ("CANVAS" → courses), if any. */
export function moduleForSource(
  source: string | null | undefined
): ModuleManifest | undefined {
  if (!source) return undefined;
  return MODULES.find((m) => m.sources.includes(source));
}

/** The whole sources modules let a goal claim ("All Canvas work"), in catalog order. */
export function sourceClaims(): ClaimOption[] {
  return MODULES.flatMap((m) =>
    Object.entries(m.claimLabels ?? {}).map(([key, label]) => ({
      key,
      label,
      title: `Every task ${m.name} adds`,
    }))
  );
}

interface ModuleRow {
  moduleId: string;
  enabled: boolean;
  position: number;
}

/**
 * Each module as one person has it: their row where they have one, the
 * module's default where they don't. Rows for modules this build no longer
 * ships are ignored. Sorted the way the rail lists them.
 */
export function resolveModuleStates(rows: readonly ModuleRow[]): ModuleState[] {
  return MODULES.map((m, index) => {
    const row = rows.find((r) => r.moduleId === m.id);
    return row
      ? { id: m.id, on: row.enabled, position: row.position }
      : { id: m.id, on: m.defaultOn, position: index };
  }).sort(
    (a, b) =>
      a.position - b.position ||
      MODULES.findIndex((m) => m.id === a.id) -
        MODULES.findIndex((m) => m.id === b.id)
  );
}

/** Task sources whose module is off: their tasks stay stored but leave every list. */
export function hiddenSourcesOf(states: readonly ModuleState[]): string[] {
  return states.filter((s) => !s.on).flatMap((s) => moduleById(s.id).sources);
}

/** Where a module turned on now goes: after everything already in the rail. */
export function nextPosition(states: readonly ModuleState[]): number {
  return states.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}
