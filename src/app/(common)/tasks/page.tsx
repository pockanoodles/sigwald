"use client";

import { useEffect, useState } from "react";

import { toast } from "sonner";

import { UrlAsk } from "@/components/navigation/UrlAsk";
import { BoardView } from "@/components/tasks/BoardView/BoardView";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskModal } from "@/components/tasks/TaskModal";
import { useTasksLenses } from "@/components/tasks/use-tasks-lenses";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { useProjectStore } from "@/store/project";
import { useTaskStore } from "@/store/task";
import { useTaskModalStore } from "@/store/taskModal";
import { useTaskPageSettings } from "@/store/taskPageSettings";

import { NewTask, Task, TaskStatus } from "@/types/task";

export default function TasksPage() {
  const {
    tasks,
    tags,
    loading,
    error,
    fetchTasks,
    fetchTags,
    createTask,
    updateTask,
    patchTask,
    createSubtask,
    deleteTask,
    createTag,
  } = useTaskStore();
  const { fetchProjects } = useProjectStore();
  // What the modules add to the page: Ladder's goal tabs along the bottom.
  const lenses = useTasksLenses();
  const { viewMode } = useTaskPageSettings();
  // View switching and Create Task live in the app top bar
  // (components/tasks/TasksTopBar.tsx); the page only owns the modal itself.
  const { isOpen, editingTask, initialGoalId, openEdit, close } =
    useTaskModalStore();

  // A task asked for by the top bar's search (?task=…), resolved once this
  // visit's fetch is in: a list from an earlier visit may not have it yet.
  const [fetched, setFetched] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ id: string } | null>(null);

  // Fetch tasks, tags and projects on mount
  useEffect(() => {
    void fetchTasks().finally(() => setFetched(true));
    fetchTags();
    fetchProjects();
  }, [fetchTasks, fetchTags, fetchProjects]);

  useEffect(() => {
    if (!asked || !fetched) return;
    setAsked(null);
    const task = tasks.find((t) => t.id === asked);
    if (!task) {
      toast.error("That task isn't in your list any more");
    } else if (viewMode === "board") {
      openEdit(task);
    } else {
      setReveal({ id: task.id });
    }
  }, [asked, fetched, tasks, viewMode, openEdit]);

  const handleCreateTask = async (task: NewTask) => {
    await createTask(task);
    await fetchTasks();
    await fetchProjects();
  };

  const handleUpdateTask = async (task: NewTask) => {
    if (editingTask) {
      await updateTask(editingTask.id, task);
      await fetchTasks();
      await fetchProjects();
    }
  };

  /** Asks first; says whether it deleted. */
  const handleDeleteTask = async (taskId: string): Promise<boolean> => {
    if (!confirm("Are you sure you want to delete this task?")) return false;
    await deleteTask(taskId);
    await fetchTasks();
    await fetchProjects();
    return true;
  };

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    try {
      await patchTask(taskId, { status });
    } catch {
      toast.error("Failed to update task");
    }
  };

  const handleCreateTag = async (name: string, color?: string) => {
    try {
      const newTag = await createTag({ name, color });
      await fetchTags(); // Refresh tags after creation
      return newTag;
    } catch (error) {
      console.error("Error creating tag:", error);
      throw error;
    }
  };

  const handleInlineEdit = async (task: Task & { goalId?: string | null }) => {
    // goalLinks is a relation (display-only); the Goal cell edits it through
    // the API's single-goal `goalId` setter instead.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, tags, createdAt, updatedAt, project, goalLinks, ...updates } =
      task;
    try {
      await patchTask(id, updates);
    } catch {
      toast.error("Failed to update task", {
        description: "Please try again later.",
      });
    }
  };

  const handleCreateSubtask = async (parentId: string, title: string) => {
    try {
      await createSubtask(parentId, title);
    } catch {
      toast.error("Failed to add subtask");
      throw new Error("Failed to add subtask");
    }
  };

  return (
    // A module's tabs run along the bottom as a sheet-tab strip at every
    // width (Ladder: one per top goal).
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col overflow-hidden" data-task-page>
        {error && (
          <Alert variant="destructive" className="m-4 mb-0">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {/* Two views: the sheet (rows on a phone) and the board. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {viewMode === "board" ? (
            <BoardView
              tasks={tasks}
              onEdit={openEdit}
              onStatusChange={handleStatusChange}
              onInlineEdit={handleInlineEdit}
            />
          ) : (
            <TaskList
              tasks={tasks}
              onEdit={openEdit}
              onDelete={handleDeleteTask}
              onStatusChange={handleStatusChange}
              onInlineEdit={handleInlineEdit}
              onCreateSubtask={handleCreateSubtask}
              reveal={reveal}
            />
          )}
        </div>

        <UrlAsk names={["task"]} onAsk={({ task }) => setAsked(task)} />

        <TaskModal
          isOpen={isOpen}
          onClose={close}
          onSave={editingTask ? handleUpdateTask : handleCreateTask}
          task={editingTask}
          tags={tags}
          onCreateTag={handleCreateTag}
          initialGoalId={initialGoalId}
          onDelete={async (id) => {
            if (await handleDeleteTask(id)) close();
          }}
        />

        {loading && (
          <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="border bg-background p-4">
              <LoadingSpinner size="lg" />
            </div>
          </div>
        )}
      </div>

      {lenses.map((lens, i) => (lens.Tabs ? <lens.Tabs key={i} /> : null))}
    </div>
  );
}
