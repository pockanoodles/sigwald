"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { usePathname, useRouter } from "next/navigation";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import {
  HiOutlineCollection,
  HiOutlineFilter,
  HiOutlineSearch,
  HiX,
} from "react-icons/hi";

import type { Command as AppCommand } from "@/lib/commands/types";
import type { SearchHit } from "@/lib/search/types";
import { cn, formatShortcut } from "@/lib/utils";

import { useSearch } from "@/hooks/use-search";
import { useCommands } from "@/hooks/useCommands";

import { useSigwaldStatusStore } from "@/store/sigwaldStatus";
import { useTaskListViewSettings } from "@/store/taskListViewSettings";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "Go to …" entries are the pages; the rail toggle lives with them but isn't one. */
const isPage = (c: AppCommand) =>
  c.section === "navigation" && c.id !== "navigation.toggle-sidebar";

/** What Up next shows with nothing typed: the top of the Focus queue. */
const UP_NEXT = 3;

/**
 * The top bar's search, one place to find anything: pages, tasks, events,
 * and whatever the modules that are on keep (people, courses and their
 * files, goals, jobs, routines), then commands. Picking a hit opens its page
 * on it. With nothing typed it offers where you're most likely headed: the
 * top of the Focus queue and every page.
 *
 * Pages and commands are matched here; everything else comes from
 * GET /api/search. On Tasks, what you typed can also filter the sheet, which
 * is why the page has no search box of its own.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [query, setQuery] = useState("");
  const [showAllCommands, setShowAllCommands] = useState(false);
  const [selected, setSelected] = useState("");
  const { searchCommands, executeCommand, getAllCommands } = useCommands();
  const search = useSearch(query, open);
  const queue = useSigwaldStatusStore((s) => s.tasks);
  const setTaskText = useTaskListViewSettings((s) => s.setSearch);

  const text = query.trim();
  const onTasks = pathname.startsWith("/tasks");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setShowAllCommands(false);
    }
  }, [open]);

  // The registry isn't reactive; it's read when the palette opens and as you type.
  const { pages, commands } = useMemo(() => {
    if (!open) return { pages: [], commands: [] };
    const matched = text ? searchCommands(text) : getAllCommands();
    return {
      pages: matched.filter(isPage),
      commands: showAllCommands
        ? getAllCommands().filter((c) => !isPage(c))
        : text
          ? matched.filter((c) => !isPage(c))
          : [],
    };
  }, [open, text, showAllCommands, searchCommands, getAllCommands]);

  const upNext = text ? [] : queue.slice(0, UP_NEXT);
  // In the server's order: the group with the best match first.
  const groups = text ? search.groups : [];
  // On Tasks, what you typed can filter the sheet: a row at the end of the
  // Tasks group, or after everything found when no task matched.
  const offerFilter = onTasks && Boolean(text);
  const filterAlone = offerFilter && !groups.some((g) => g.id === "tasks");

  // The first row, in the order drawn below: Enter takes the best answer.
  const firstHit = groups[0]?.hits[0];
  const firstValue = upNext[0]
    ? `next:${upNext[0].id}`
    : pages[0]
      ? `page:${pages[0].id}`
      : firstHit
        ? `hit:${groups[0].id}:${firstHit.id}`
        : offerFilter
          ? "filter"
          : commands[0]
            ? `cmd:${commands[0].id}`
            : "";
  useEffect(() => setSelected(firstValue), [firstValue]);

  const close = () => onOpenChange(false);
  const go = (href: string) => {
    close();
    router.push(href);
  };
  const run = (id: string) => {
    close();
    void executeCommand(id);
  };
  const filterTasks = () => {
    setTaskText(text);
    close();
  };

  const nothing =
    Boolean(text) &&
    search.status === "ready" &&
    !pages.length &&
    !groups.length &&
    !commands.length &&
    !offerFilter;

  const filterRow = (
    <Row
      value="filter"
      onSelect={filterTasks}
      icon={<HiOutlineFilter className="h-4 w-4" />}
      title={`Filter tasks by “${text}”`}
      detail="Narrows the sheet and the board"
    />
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-stage/60" />
        <Dialog.Content className="fixed left-1/2 top-[8%] z-50 w-[calc(100vw-1.5rem)] max-w-[640px] -translate-x-1/2 sm:top-[16%] sm:w-full">
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Dialog.Description className="sr-only">
            Find a task, event, person or page, or run a command
          </Dialog.Description>

          <Command
            shouldFilter={false}
            value={selected}
            onValueChange={setSelected}
            loop
            className={cn(
              "er-brackets overflow-hidden rounded-lg border border-line bg-popover text-popover-foreground [--arm:14px] [--bracket:var(--er-ink)] [--stroke:2px]",
              // Group headings in the kit's label voice (.er-label).
              "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-muted-foreground"
            )}
          >
            <div className="flex items-center border-b px-3">
              <HiOutlineSearch className="h-5 w-5 flex-none text-muted-foreground" />
              <Command.Input
                placeholder="Search anything, or jump to a page"
                className="h-12 min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground"
                value={query}
                onValueChange={setQuery}
              />
              {search.status === "loading" ? (
                <span className="er-label flex-none text-muted-foreground">
                  Searching
                </span>
              ) : query ? (
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <HiX className="h-5 w-5" />
                </button>
              ) : (
                <kbd className="hidden flex-none font-mono text-xs text-muted-foreground sm:block">
                  ⌘K
                </kbd>
              )}
              <Dialog.Close
                className="ml-2 p-2 text-muted-foreground hover:text-foreground"
                aria-label="Close search"
              >
                <HiX className="h-5 w-5" />
              </Dialog.Close>
            </div>

            <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
              {upNext.length > 0 && (
                <Command.Group heading="Up next">
                  {upNext.map((t) => (
                    <Row
                      key={t.id}
                      value={`next:${t.id}`}
                      onSelect={() =>
                        go(`/tasks?task=${encodeURIComponent(t.id)}`)
                      }
                      title={t.title}
                      when={t.sigwald?.countdownHuman ?? null}
                    />
                  ))}
                </Command.Group>
              )}

              {pages.length > 0 && (
                <Command.Group heading="Go to">
                  {pages.map((c) => (
                    <CommandRow
                      key={c.id}
                      command={c}
                      prefix="page"
                      onSelect={run}
                    />
                  ))}
                </Command.Group>
              )}

              {groups.map((group) => (
                <Command.Group key={group.id} heading={group.label}>
                  {group.hits.map((hit) => (
                    <HitRow
                      key={hit.id}
                      group={group.id}
                      hit={hit}
                      onSelect={go}
                    />
                  ))}
                  {group.id === "tasks" && offerFilter && filterRow}
                </Command.Group>
              ))}
              {filterAlone && (
                <Command.Group heading="Tasks">{filterRow}</Command.Group>
              )}

              {text && search.status === "loading" && !groups.length && (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Searching…
                </p>
              )}
              {text && search.status === "error" && (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Search isn&apos;t answering right now. Pages and commands
                  still work.
                </p>
              )}
              {nothing && (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Nothing matches “{text}”.
                </p>
              )}

              {commands.length > 0 && (
                <Command.Group heading="Commands">
                  {commands.map((c) => (
                    <CommandRow
                      key={c.id}
                      command={c}
                      prefix="cmd"
                      onSelect={run}
                    />
                  ))}
                </Command.Group>
              )}

              {!text && !showAllCommands && (
                <Command.Group heading="Commands">
                  <Row
                    value="all-commands"
                    onSelect={() => setShowAllCommands(true)}
                    icon={<HiOutlineCollection className="h-4 w-4" />}
                    title="Show all commands"
                  />
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One row: an optional icon, the name, a quiet second word, and a when or a shortcut at the right. */
function Row({
  value,
  onSelect,
  icon,
  title,
  detail,
  when,
  shortcut,
}: {
  value: string;
  onSelect: () => void;
  icon?: ReactNode;
  title: string;
  detail?: string | null;
  when?: string | null;
  shortcut?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-hover aria-selected:text-foreground"
    >
      {icon ? (
        <span className="flex-none text-muted-foreground">{icon}</span>
      ) : null}
      <span className="min-w-0 truncate text-foreground">{title}</span>
      {detail ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {detail}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {when ? (
        <span className="flex-none font-mono text-xs tabular-nums text-muted-foreground">
          {when}
        </span>
      ) : null}
      {shortcut ? (
        <kbd className="flex-none font-mono text-xs text-muted-foreground">
          {formatShortcut(shortcut)}
        </kbd>
      ) : null}
    </Command.Item>
  );
}

function HitRow({
  group,
  hit,
  onSelect,
}: {
  group: string;
  hit: SearchHit;
  onSelect: (href: string) => void;
}) {
  return (
    <Row
      value={`hit:${group}:${hit.id}`}
      onSelect={() => onSelect(hit.href)}
      title={hit.title}
      detail={hit.detail}
      when={hit.when}
    />
  );
}

function CommandRow({
  command,
  prefix,
  onSelect,
}: {
  command: AppCommand;
  prefix: "page" | "cmd";
  onSelect: (id: string) => void;
}) {
  const Icon = command.icon;
  return (
    <Row
      value={`${prefix}:${command.id}`}
      onSelect={() => onSelect(command.id)}
      icon={Icon ? <Icon className="h-4 w-4" /> : undefined}
      // A page reads as its name; "Go to" is the group's heading.
      title={
        prefix === "page" ? command.title.replace(/^Go to /, "") : command.title
      }
      shortcut={command.shortcut}
    />
  );
}
