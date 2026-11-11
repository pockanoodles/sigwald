/**
 * Each service's connection check (server only): one cheap read, run before
 * a connection is saved, that proves the token works and names the account.
 * A test keeps one here for every service that needs an account.
 */
import { verifyAirtable } from "./airtable/client";
import { verifyAsana } from "./asana/client";
import { verifyBeehiiv } from "./beehiiv/client";
import { verifyCalcom } from "./calcom/client";
import { verifyCalendly } from "./calendly/client";
import { verifyClickup } from "./clickup/client";
import { verifyClockify } from "./clockify/client";
import { verifyFigma } from "./figma/client";
import { verifyGhost } from "./ghost/client";
import { verifyGithub } from "./github/client";
import { verifyGitlab } from "./gitlab/client";
import { verifyHarvest } from "./harvest/client";
import { verifyHubspot } from "./hubspot/client";
import { verifyIntervals } from "./intervals/client";
import { verifyJira } from "./jira/client";
import { verifyKit } from "./kit/client";
import { verifyLemonSqueezy } from "./lemonsqueezy/client";
import { verifyLinear } from "./linear/client";
import { verifyMoodle } from "./moodle/client";
import { verifyNotion } from "./notion/client";
import { verifyPagerduty } from "./pagerduty/client";
import { verifyPatreon } from "./patreon/client";
import { verifyPipedrive } from "./pipedrive/client";
import { verifyPlausible } from "./plausible/client";
import { verifyReadwise } from "./readwise/client";
import { verifySentry } from "./sentry/client";
import { verifyStripe } from "./stripe/client";
import { verifyTodoist } from "./todoist/client";
import { verifyToggl } from "./toggl/client";
import { verifyTransistor } from "./transistor/client";
import { verifyTrello } from "./trello/client";
import type { VerifyFn } from "./types";
import { verifyUnsplash } from "./unsplash/client";
import { verifyUptimeRobot } from "./uptimerobot/client";
import { verifyWaniKani } from "./wanikani/client";
import { verifyWordpress } from "./wordpress/client";
import { verifyYnab } from "./ynab/client";
import { verifyYoutube } from "./youtube/client";
import { verifyZendesk } from "./zendesk/client";
import { verifyZotero } from "./zotero/client";

export const VERIFIERS: Record<string, VerifyFn> = {
  github: verifyGithub,
  linear: verifyLinear,
  stripe: verifyStripe,
  gitlab: verifyGitlab,
  jira: verifyJira,
  sentry: verifySentry,
  pagerduty: verifyPagerduty,
  asana: verifyAsana,
  clickup: verifyClickup,
  trello: verifyTrello,
  todoist: verifyTodoist,
  notion: verifyNotion,
  airtable: verifyAirtable,
  figma: verifyFigma,
  ghost: verifyGhost,
  wordpress: verifyWordpress,
  beehiiv: verifyBeehiiv,
  kit: verifyKit,
  harvest: verifyHarvest,
  toggl: verifyToggl,
  clockify: verifyClockify,
  ynab: verifyYnab,
  lemonsqueezy: verifyLemonSqueezy,
  hubspot: verifyHubspot,
  pipedrive: verifyPipedrive,
  calendly: verifyCalendly,
  calcom: verifyCalcom,
  zendesk: verifyZendesk,
  youtube: verifyYoutube,
  transistor: verifyTransistor,
  patreon: verifyPatreon,
  unsplash: verifyUnsplash,
  zotero: verifyZotero,
  readwise: verifyReadwise,
  moodle: verifyMoodle,
  wanikani: verifyWaniKani,
  intervals: verifyIntervals,
  uptimerobot: verifyUptimeRobot,
  plausible: verifyPlausible,
};
