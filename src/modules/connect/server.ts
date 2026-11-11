/**
 * What a connector module adds to the server's side of the core, made from
 * its pull (server only). A connector module's entry in `SERVER_MODULES` is
 * one call: `github: connectorServer("github", pull)`.
 */
import type { Db } from "@/lib/prisma";

import { moduleById } from "@/modules";
import type { ServerContributions } from "@/modules/server";
import type { ClaimOption, ModuleId } from "@/modules/types";

import type { PullFn } from "./pull";
import { runPull } from "./run";

/** The groups its tasks file under (a repo, a team), each a claim the goal form offers. */
export async function connectorClaimOptions(
  db: Db,
  userId: string,
  moduleId: ModuleId
): Promise<ClaimOption[]> {
  const sync = await db.moduleSync.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
    select: { groups: true },
  });
  const groups =
    sync?.groups &&
    typeof sync.groups === "object" &&
    !Array.isArray(sync.groups)
      ? (sync.groups as Record<string, unknown>)
      : {};
  const { name } = moduleById(moduleId);
  return Object.entries(groups)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([key, label]) => ({
      key,
      label,
      title: `Every ${name} task in ${label}`,
    }));
}

export function connectorServer(
  moduleId: ModuleId,
  pull: PullFn
): ServerContributions {
  return {
    connector: { pull },
    jobs: [
      {
        id: `${moduleId}.pull`,
        run: (userId) => runPull(userId, moduleId, pull),
      },
    ],
    claimOptions: (db, userId) => connectorClaimOptions(db, userId, moduleId),
  };
}
