/**
 * Each service's connection check (server only): one cheap read, run before
 * a connection is saved, that proves the token works and names the account.
 * A test keeps one here for every service that needs an account.
 */
import { verifyAirtable } from "./airtable/client";
import { verifyAsana } from "./asana/client";
import { verifyBeehiiv } from "./beehiiv/client";
import { verifyClickup } from "./clickup/client";
import { verifyFigma } from "./figma/client";
import { verifyGhost } from "./ghost/client";
import { verifyGithub } from "./github/client";
import { verifyGitlab } from "./gitlab/client";
import { verifyJira } from "./jira/client";
import { verifyKit } from "./kit/client";
import { verifyLinear } from "./linear/client";
import { verifyNotion } from "./notion/client";
import { verifyPagerduty } from "./pagerduty/client";
import { verifySentry } from "./sentry/client";
import { verifyStripe } from "./stripe/client";
import { verifyTodoist } from "./todoist/client";
import { verifyTrello } from "./trello/client";
import type { VerifyFn } from "./types";
import { verifyWordpress } from "./wordpress/client";

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
};
