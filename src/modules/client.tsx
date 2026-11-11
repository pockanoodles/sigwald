"use client";

import type { ComponentType } from "react";

import type { IconType } from "react-icons";
import {
  HiOutlineBriefcase,
  HiOutlineChartBar,
  HiOutlineCollection,
  HiOutlineFlag,
  HiOutlineUserGroup,
} from "react-icons/hi";
import { IoBarbellOutline, IoNutritionOutline } from "react-icons/io5";

import { ConnectCanvasOffer } from "@/components/courses/ConnectCanvasOffer";
import { CourseActivityStatus } from "@/components/courses/CourseActivityStatus";
import {
  CoursesTopBarActions,
  CoursesTopBarViews,
} from "@/components/courses/CoursesTopBar";
import {
  LadderTopBarActions,
  LadderTopBarViews,
} from "@/components/ladder/LadderTopBar";
import {
  CanvasTaskBody,
  CanvasTaskContext,
  CanvasTaskPane,
} from "@/components/packet/TaskSlots";
import { CanvasLmsSettings } from "@/components/settings/CanvasLmsSettings";
import type { TasksLens } from "@/components/tasks/lens";

import type { FocusQueueTask } from "@/lib/sigwald/parse-task";

import { moduleForSource } from "@/modules";
import { connectorClient } from "@/modules/connect/client";
import { InboxPane } from "@/modules/inbox/components/InboxPane";
import { useCoursesTasksLens } from "@/modules/courses/tasks";
import { TodayGoalSection } from "@/modules/ladder/components/TodayGoalSection";
import { useLadderTasksLens } from "@/modules/ladder/tasks";
import {
  NutritionStatus,
  NutritionTopBarActions,
  NutritionTopBarViews,
} from "@/modules/nutrition/components/NutritionTopBar";
import {
  PeopleTopBarActions,
  PeopleTopBarViews,
} from "@/modules/people/components/PeopleTopBar";
import {
  TrainingTopBarActions,
  TrainingTopBarViews,
} from "@/modules/training/components/TrainingTopBar";
import {
  WorkoutTaskBody,
  WorkoutTaskPane,
} from "@/modules/training/components/WorkoutSlots";
import type { ModuleId, ModuleManifest } from "@/modules/types";
import {
  TimesheetTaskBody,
  TimesheetTaskPane,
} from "@/modules/work/components/TimesheetSlots";
import {
  WorkTopBarActions,
  WorkTopBarViews,
} from "@/modules/work/components/WorkTopBar";
import { WorkStatus } from "@/modules/work/components/WorkStatus";

/**
 * What each module puts into the browser's side of the core. The core reads
 * this list and never imports a module's components itself; each slot only
 * draws while its module is on.
 */
export interface ClientContributions {
  /** Its "Go to" entry in ⌘K, for a module with a page. */
  command?: { icon: IconType; shortcut?: string };
  /** Top bar, beside the page name on its page: view switchers. */
  Views?: ComponentType;
  /** Top bar, right, on its page: things that change its data. */
  Actions?: ComponentType;
  /** Its Views carry a heading of their own (Ladder: the cycle), so below
   *  desktop width the bar drops the page name for room. */
  headingInViews?: boolean;
  /** Its settings, on its row in /modules. */
  Settings?: ComponentType;
  /** At most one count in the top bar's status strip, on every route. */
  Status?: ComponentType;
  /** What Today offers before there's anything to rank. */
  FirstRun?: ComponentType;
  /** A section in Today's panel for the selected task. */
  TodayTaskSection?: ComponentType<{ task: FocusQueueTask }>;
  /** Focus's work column for a task from one of its sources, in place of
   *  the plain description. */
  TaskBody?: ComponentType<{ task: FocusQueueTask }>;
  /** More in Focus's context column for a task from one of its sources. */
  TaskContext?: ComponentType<{ task: FocusQueueTask }>;
  /** The task sheet's reading pane for a task from one of its sources. */
  TaskPane?: ComponentType<{ taskId: string }>;
  /**
   * What it adds to the Tasks page (columns, tabs, row labels, pinned rows).
   * A hook, called on every render whether the module is on or off: it hands
   * back null while off. See components/tasks/lens.ts.
   */
  useTasksLens?: () => TasksLens | null;
}

export const CLIENT_MODULES: Record<ModuleId, ClientContributions> = {
  courses: {
    command: { icon: HiOutlineCollection, shortcut: "gl" },
    Views: CoursesTopBarViews,
    Actions: CoursesTopBarActions,
    Settings: CanvasLmsSettings,
    Status: CourseActivityStatus,
    FirstRun: ConnectCanvasOffer,
    TaskBody: CanvasTaskBody,
    TaskContext: CanvasTaskContext,
    TaskPane: CanvasTaskPane,
    useTasksLens: useCoursesTasksLens,
  },
  ladder: {
    command: { icon: HiOutlineFlag, shortcut: "gg" },
    Views: LadderTopBarViews,
    Actions: LadderTopBarActions,
    headingInViews: true,
    TodayTaskSection: TodayGoalSection,
    useTasksLens: useLadderTasksLens,
  },
  people: {
    command: { icon: HiOutlineUserGroup, shortcut: "gp" },
    Views: PeopleTopBarViews,
    Actions: PeopleTopBarActions,
  },
  training: {
    command: { icon: IoBarbellOutline, shortcut: "gw" },
    Views: TrainingTopBarViews,
    Actions: TrainingTopBarActions,
    TaskBody: WorkoutTaskBody,
    TaskPane: WorkoutTaskPane,
  },
  nutrition: {
    command: { icon: IoNutritionOutline, shortcut: "gn" },
    Views: NutritionTopBarViews,
    Actions: NutritionTopBarActions,
    Status: NutritionStatus,
  },
  work: {
    command: { icon: HiOutlineBriefcase, shortcut: "gj" },
    Views: WorkTopBarViews,
    Actions: WorkTopBarActions,
    Status: WorkStatus,
    TaskBody: TimesheetTaskBody,
    TaskPane: TimesheetTaskPane,
  },
  // No page: Code's days show in Tasks and on Stats as finished work.
  code: {},
  // Connector modules (src/modules/connect): their pane in /modules, their
  // tasks' panes and a count in the top bar, all made from the manifest.
  github: connectorClient("github"),
  linear: connectorClient("linear"),
  stripe: connectorClient("stripe"),
  daylight: connectorClient("daylight"),
  // The Inbox's pane adds its private address above the connector pane.
  inbox: { ...connectorClient("inbox"), Settings: InboxPane },
  readouts: { command: { icon: HiOutlineChartBar, shortcut: "gr" } },
  deadlines: connectorClient("deadlines"),
  sheet: connectorClient("sheet"),
  holidays: connectorClient("holidays"),
  weather: connectorClient("weather"),
  jobs: connectorClient("jobs"),
  arxiv: connectorClient("arxiv"),
  feeds: connectorClient("feeds"),
  fedreg: connectorClient("fedreg"),
  scholar: connectorClient("scholar"),
  codeforces: connectorClient("codeforces"),
  bluesky: connectorClient("bluesky"),
  hackernews: connectorClient("hackernews"),
  gitlab: connectorClient("gitlab"),
  jira: connectorClient("jira"),
  sentry: connectorClient("sentry"),
  pagerduty: connectorClient("pagerduty"),
  asana: connectorClient("asana"),
  clickup: connectorClient("clickup"),
  trello: connectorClient("trello"),
  todoist: connectorClient("todoist"),
  notion: connectorClient("notion"),
  airtable: connectorClient("airtable"),
  figma: connectorClient("figma"),
  ghost: connectorClient("ghost"),
  wordpress: connectorClient("wordpress"),
  beehiiv: connectorClient("beehiiv"),
  kit: connectorClient("kit"),
  harvest: connectorClient("harvest"),
  toggl: connectorClient("toggl"),
  clockify: connectorClient("clockify"),
  ynab: connectorClient("ynab"),
  lemonsqueezy: connectorClient("lemonsqueezy"),
};

/**
 * The module that owns a task's source, with what it draws for that task.
 * Null for a task from the core (made by hand, a calendar). It doesn't wait
 * to learn which modules are on: a task from a module that's off never
 * reaches the browser (the server hides its source), and waiting would
 * print a Canvas task's raw HTML description for a moment.
 */
export function useTaskModule(
  source: string | null | undefined
): (ClientContributions & { manifest: ModuleManifest }) | null {
  const owner = moduleForSource(source);
  return owner ? { manifest: owner, ...CLIENT_MODULES[owner.id] } : null;
}
