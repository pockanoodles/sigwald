/**
 * Each service's connection check (server only): one cheap read, run before
 * a connection is saved, that proves the token works and names the account.
 * A test keeps one here for every service that needs an account.
 */
import { verifyGithub } from "./github/client";
import { verifyLinear } from "./linear/client";
import { verifyStripe } from "./stripe/client";
import type { VerifyFn } from "./types";

export const VERIFIERS: Record<string, VerifyFn> = {
  github: verifyGithub,
  linear: verifyLinear,
  stripe: verifyStripe,
};
