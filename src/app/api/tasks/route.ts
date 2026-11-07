import { NextRequest, NextResponse } from "next/server";

import { RRule } from "rrule";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { findForeignRef, foreignRefMessage } from "@/lib/auth/ownership";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  ChangeType,
  TaskChangeTracker,
} from "@/lib/task-sync/task-change-tracker";
import { normalizeRecurrenceRule } from "@/lib/utils/normalize-recurrence-rules";
import { taskColumnsOnly } from "@/lib/utils/task-columns";

import { moduleTaskFacts, tasksChanged } from "@/modules/hooks";
import { moduleView, visibleSourceWhere } from "@/modules/state";

import { EnergyLevel, TaskStatus, TimePreference } from "@/types/task";

const LOG_SOURCE = "tasks-route";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { searchParams } = new URL(request.url);
    const status = searchParams.getAll("status") as TaskStatus[];
    const tagIds = searchParams.getAll("tagIds");
    const energyLevel = searchParams.getAll("energyLevel") as EnergyLevel[];
    const timePreference = searchParams.getAll(
      "timePreference"
    ) as TimePreference[];
    const search = searchParams.get("search");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const taskStartDate = searchParams.get("taskStartDate");
    const hideUpcomingTasks = searchParams.get("hideUpcomingTasks") === "true";

    const now = newDate();
    const modules = await moduleView(userId);
    const tasks = await prisma.task.findMany({
      where: {
        // Filter by the current user's ID
        userId,
        ...(status.length > 0 && { status: { in: status } }),
        ...(energyLevel.length > 0 && { energyLevel: { in: energyLevel } }),
        ...(timePreference.length > 0 && {
          preferredTime: { in: timePreference },
        }),
        ...(tagIds.length > 0 && { tags: { some: { id: { in: tagIds } } } }),
        ...(startDate &&
          endDate && {
            dueDate: {
              gte: newDate(startDate),
              lte: newDate(endDate),
            },
          }),
        ...(taskStartDate && {
          startDate: {
            gte: newDate(taskStartDate),
          },
        }),
        // Each condition that needs an OR gets its own entry here: two
        // spread `OR` keys would silently overwrite each other, which is how
        // a search used to vanish whenever upcoming tasks were hidden.
        AND: [
          // Tasks from a module that's off stay stored but leave the list.
          visibleSourceWhere(modules.hidden),
          ...(search
            ? [
                {
                  OR: [
                    { title: { contains: search } },
                    { description: { contains: search } },
                  ],
                },
              ]
            : []),
          ...(hideUpcomingTasks
            ? [{ OR: [{ startDate: null }, { startDate: { lte: now } }] }]
            : []),
        ],
      },
      include: {
        tags: true,
        project: true,
        goalLinks: { select: { goalId: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // What the modules add to their tasks (Courses: courseName and
    // submissionStatus, which ops reads), spread onto each one.
    const facts = await moduleTaskFacts(
      prisma,
      userId,
      tasks.map((t) => ({ id: t.id })),
      modules.isOn
    );
    return NextResponse.json(tasks.map((t) => ({ ...t, ...facts.get(t.id) })));
  } catch (error) {
    logger.error(
      "Error fetching tasks:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const json = await request.json();
    // `goalId` is a convenience alias: it becomes a TaskGoalLink row (tasks
    // link to goals many-to-many; /api/sigwald/task-links manages further links).
    const {
      tagIds,
      recurrenceRule,
      goalId,
      parentTaskId,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      parentTask,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      subtasks,
      ...body
    } = json;
    // Only Task's columns: a client copying a task sends its facts too.
    const taskData = taskColumnsOnly(body);

    const foreign = await findForeignRef(userId, {
      projectId: taskData.projectId,
      tagIds,
      goalId,
    });
    if (foreign) {
      return new NextResponse(foreignRefMessage(foreign), { status: 404 });
    }

    // One-level subtasks: inherit the parent's project, never auto-schedule,
    // never sync outward (Canvas/Outlook stay a single assignment).
    if (parentTaskId) {
      const parent = await prisma.task.findFirst({
        where: { id: parentTaskId, userId },
      });
      if (!parent) {
        return new NextResponse("Parent task not found", { status: 400 });
      }
      if (parent.parentTaskId) {
        return new NextResponse("Subtasks cannot have children", {
          status: 400,
        });
      }
      const maxOrder = await prisma.task.aggregate({
        where: { parentTaskId, userId },
        _max: { order: true },
      });
      taskData.parentTaskId = parentTaskId;
      taskData.order = (maxOrder._max.order ?? 0) + 1;
      taskData.isAutoScheduled = false;
      taskData.skipSync = true;
      if (!taskData.projectId) {
        taskData.projectId = parent.projectId;
      }
    }

    // Normalize and validate recurrence rule if provided
    const standardizedRecurrenceRule = recurrenceRule
      ? normalizeRecurrenceRule(recurrenceRule)
      : undefined;

    if (standardizedRecurrenceRule) {
      try {
        // Attempt to parse the standardized RRule string to validate it
        RRule.fromString(standardizedRecurrenceRule);
      } catch (error) {
        logger.error(
          "Error parsing recurrence rule:",
          {
            error: error instanceof Error ? error.message : String(error),
          },
          LOG_SOURCE
        );
        return new NextResponse("Invalid recurrence rule", { status: 400 });
      }
    }

    // Find the project's task mapping if it exists
    let mappingId = null;
    if (taskData.projectId) {
      const mapping = await prisma.taskListMapping.findFirst({
        where: {
          projectId: taskData.projectId,
        },
      });
      if (mapping) {
        mappingId = mapping.id;
      }
    }

    const task = await prisma.task.create({
      data: {
        ...taskData,
        // Associate the task with the current user
        userId,
        isRecurring: !!recurrenceRule,
        recurrenceRule: standardizedRecurrenceRule,
        // A goal picked at creation (a goal tab's pre-link) is a choice, so
        // the goal rules leave the task alone from here on.
        ...(goalId && { goalLinks: { create: [{ goalId }] } }),
        goalsPinned: Boolean(goalId),
        ...(tagIds && {
          tags: {
            connect: tagIds.map((id: string) => ({ id })),
          },
        }),
      },
      include: {
        tags: true,
        project: true,
      },
    });

    // No goal picked: file it by the goal rules now (a pump 2 task under
    // the goal that claims it), instead of waiting for the next projection.
    if (!goalId && task.source) {
      await tasksChanged(prisma, userId, [task.id]);
    }

    // Track the creation for sync purposes if the task is in a mapped project.
    // skipSync children (subtasks) stay local — do not push them to Outlook.
    if (mappingId && !task.skipSync) {
      const changeTracker = new TaskChangeTracker();
      await changeTracker.trackChange(
        task.id,
        "CREATE" as ChangeType,
        userId,
        { task },
        undefined, // providerId will be determined later during sync
        mappingId
      );

      logger.info(
        `Tracked CREATE change for task ${task.id} in mapping ${mappingId}`,
        {
          taskId: task.id,
          mappingId,
        },
        LOG_SOURCE
      );
    }

    const goalLinks = await prisma.taskGoalLink.findMany({
      where: { taskId: task.id },
      select: { goalId: true },
    });
    return NextResponse.json({ ...task, goalLinks });
  } catch (error) {
    logger.error(
      "Error creating task:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
