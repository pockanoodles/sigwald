"use client";

import type { ComponentType } from "react";

import { moduleById } from "@/modules";
import type { ClientContributions } from "@/modules/client";
import type { ModuleId } from "@/modules/types";

import { ConnectPane } from "./components/ConnectPane";
import {
  ConnectorTaskContext,
  ConnectorTaskPane,
  ReadingStatus,
} from "./components/ConnectorSlots";

/**
 * What a connector module puts into the browser's side of the core, made
 * from its manifest. Its entry in `CLIENT_MODULES` is one call:
 * `github: connectorClient("github")`. A module with a page of its own
 * spreads more slots over it.
 */
export function connectorClient(moduleId: ModuleId): ClientContributions {
  const spec = moduleById(moduleId).connect;
  if (!spec) throw new Error(`${moduleId} isn't a connector module`);

  const Settings: ComponentType = () => <ConnectPane moduleId={moduleId} />;
  Settings.displayName = `ConnectPane(${moduleId})`;
  const Status: ComponentType = () => <ReadingStatus moduleId={moduleId} />;
  Status.displayName = `ReadingStatus(${moduleId})`;

  const makesTasks = spec.makes.includes("tasks");
  return {
    Settings,
    ...(spec.makes.includes("readings") ? { Status } : {}),
    ...(makesTasks
      ? { TaskPane: ConnectorTaskPane, TaskContext: ConnectorTaskContext }
      : {}),
  };
}
