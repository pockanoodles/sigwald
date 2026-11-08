"use client";

import { type ReactNode, useMemo } from "react";

import { HiOutlineFilter, HiX } from "react-icons/hi";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { cn } from "@/lib/utils";

import {
  DEFAULT_CONDITIONS,
  type FilterCondition,
  useTaskListViewSettings,
} from "@/store/taskListViewSettings";

import type { FilterOption, TaskFilterField } from "./fields";
import {
  countDeferred,
  countOptions,
  describeCondition,
  isActiveCondition,
  optionsWithPicked,
  sameConditions,
} from "./match";
import type { VisibleTasks } from "./use-visible-tasks";

/**
 * The Tasks page's filters, behind one button. They used to be an "Add
 * filter" menu plus a chip per active filter in the strip, which pushed the
 * strip onto a second line in the sheet; now the strip holds the button and
 * the menu holds everything else.
 *
 * Every field is a row that reads as its condition ("Status is Todo, In
 * progress"), and every value is one click with a count beside it: how many
 * rows have that value with every other filter in place. All the fields are
 * open at once, so there's nothing to drill into and nothing hidden behind a
 * submenu. Text is a filter like the others, and counts on the button like
 * them: the page has no search box of its own (the top bar's search sets it).
 */

const LABEL = "font-mono text-xs uppercase tracking-[0.08em]";

export function TaskFilterMenu({ view }: { view: VisibleTasks }) {
  const conditions = useTaskListViewSettings((s) => s.conditions);
  const search = useTaskListViewSettings((s) => s.search);
  const active = view.fields.filter((f) => isActiveCondition(conditions[f.id]));
  const onCount = active.length + (search ? 1 : 0);

  // The button says what's on without opening the menu.
  const summary = [
    ...(search ? [`Text has “${search}”`] : []),
    ...active.map((f) =>
      describeCondition(
        f,
        conditions[f.id],
        optionsWithPicked(f.options(view.parents), conditions[f.id])
      )
    ),
  ].join("\n");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={summary || "No filters"}
          aria-label={onCount ? `Filter, ${onCount} on` : "Filter"}
          className={cn(
            LABEL,
            "flex h-7 flex-none items-center gap-1.5 border px-2 transition-colors duration-150 data-[state=open]:border-foreground data-[state=open]:text-foreground",
            onCount
              ? "border-foreground/40 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <HiOutlineFilter aria-hidden className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Filter</span>
          {onCount ? (
            <span className="bg-foreground px-1 tabular-nums text-background">
              {onCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(44rem,calc(100vw-1rem))] p-0"
      >
        <FilterPanel view={view} />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted only while the menu is open, so the counts cost nothing otherwise. */
function FilterPanel({ view }: { view: VisibleTasks }) {
  const conditions = useTaskListViewSettings((s) => s.conditions);
  const showDeferred = useTaskListViewSettings((s) => s.showDeferred);
  const search = useTaskListViewSettings((s) => s.search);
  const setSearch = useTaskListViewSettings((s) => s.setSearch);
  const setCondition = useTaskListViewSettings((s) => s.setCondition);
  const setShowDeferred = useTaskListViewSettings((s) => s.setShowDeferred);
  const clearConditions = useTaskListViewSettings((s) => s.clearConditions);
  const resetFilters = useTaskListViewSettings((s) => s.resetFilters);

  const { fields, parents, childrenOf, filters, mode } = view;
  const rows = useMemo(() => {
    const scope = { parents, childrenOf, filters, mode };
    return (
      fields
        .map((field) => ({
          field,
          options: optionsWithPicked(
            field.options(parents),
            conditions[field.id]
          ),
          counts: countOptions(field, scope),
        }))
        // An open field with a single value has nothing to choose between,
        // unless a pick is still on it.
        .filter(
          ({ field, options }) =>
            !field.open ||
            options.length > 1 ||
            isActiveCondition(conditions[field.id])
        )
    );
  }, [fields, parents, childrenOf, filters, mode, conditions]);
  const deferred = useMemo(
    () => countDeferred({ parents, childrenOf, filters, mode }),
    [parents, childrenOf, filters, mode]
  );

  const anyActive =
    Boolean(search) || fields.some((f) => isActiveCondition(conditions[f.id]));
  const atDefault =
    !showDeferred && sameConditions(conditions, DEFAULT_CONDITIONS);

  const toggleValue = (field: TaskFilterField, value: string) => {
    const current = conditions[field.id];
    const values = current?.values.includes(value)
      ? current.values.filter((v) => v !== value)
      : [...(current?.values ?? []), value];
    setCondition(field.id, { values, exclude: current?.exclude });
  };
  const toggleExclude = (field: TaskFilterField) => {
    const current = conditions[field.id];
    setCondition(field.id, {
      values: current?.values ?? [],
      exclude: !current?.exclude,
    });
  };

  return (
    <div className="flex max-h-[min(70vh,36rem)] flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-border px-3 py-2">
        <span className={cn(LABEL, "font-semibold text-foreground")}>
          Filter
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {view.visible.length} of {view.parents.length} tasks
        </span>
        <div className="ml-auto flex items-center gap-4">
          <QuietAction onClick={clearConditions} disabled={!anyActive}>
            Clear all
          </QuietAction>
          <QuietAction
            onClick={resetFilters}
            disabled={atDefault}
            title="Open work only, deferred tasks hidden"
          >
            Reset
          </QuietAction>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        <FilterRow label="Text" active={Boolean(search)}>
          <TextCondition value={search ?? ""} onChange={setSearch} />
        </FilterRow>
        {rows.map(({ field, options, counts }) => (
          <FilterRow
            key={field.id}
            label={field.label}
            condition={conditions[field.id]}
            onToggleExclude={() => toggleExclude(field)}
          >
            {options.map((option) => (
              <ValueChip
                key={option.value}
                option={option}
                count={counts.get(option.value) ?? 0}
                picked={conditions[field.id]?.values.includes(option.value)}
                exclude={conditions[field.id]?.exclude}
                onClick={() => toggleValue(field, option.value)}
              />
            ))}
          </FilterRow>
        ))}
      </div>

      <div className="flex-none border-t border-border py-1.5">
        <FilterRow label="Deferred">
          <ValueChip
            option={{
              value: "show",
              label: "Show",
              title:
                "Tasks deferred until later. A text filter always includes them.",
            }}
            count={deferred}
            picked={showDeferred}
            onClick={() => setShowDeferred(!showDeferred)}
          />
        </FilterRow>
      </div>
    </div>
  );
}

/**
 * One field: its name, then "is" or "is not", then its values. The operator
 * keeps its slot whether or not anything is picked, so the values never move
 * when you flip it.
 */
function FilterRow({
  label,
  condition,
  active = isActiveCondition(condition),
  onToggleExclude,
  children,
}: {
  label: string;
  condition?: FilterCondition;
  /** Whether it narrows anything; a field's condition says, by default. */
  active?: boolean;
  /** Omitted for a row with no operator (Text, Deferred). */
  onToggleExclude?: () => void;
  children: ReactNode;
}) {
  const exclude = Boolean(condition?.exclude);
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-start gap-x-2 gap-y-1 px-3 py-1 sm:flex-nowrap"
    >
      <span
        className={cn(
          LABEL,
          "w-24 flex-none leading-7",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      {onToggleExclude ? (
        <button
          type="button"
          onClick={onToggleExclude}
          aria-pressed={exclude}
          title={exclude ? "Switch to “is”" : "Switch to “is not”"}
          className={cn(
            LABEL,
            "h-7 w-16 flex-none border transition-colors duration-150",
            exclude
              ? "border-foreground text-foreground"
              : "border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          )}
        >
          {exclude ? "is not" : "is"}
        </button>
      ) : (
        <span aria-hidden className="w-16 flex-none" />
      )}
      <div className="flex min-w-0 basis-full flex-wrap gap-1 sm:basis-auto">
        {children}
      </div>
    </div>
  );
}

/**
 * A value, one click. Picked under "is" it's an ink plate; picked under "is
 * not" it's struck through, since it's the thing being taken out. The count
 * is what it would leave, so a value nothing has reads quieter but stays.
 */
function ValueChip({
  option,
  count,
  picked = false,
  exclude = false,
  onClick,
}: {
  option: FilterOption;
  count: number;
  picked?: boolean;
  exclude?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={picked}
      title={option.title}
      className={cn(
        "flex h-7 items-center gap-1.5 border px-2 font-mono text-xs transition-colors duration-150",
        picked && !exclude && "border-foreground bg-foreground text-background",
        picked && exclude && "border-foreground text-foreground",
        !picked &&
          "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        !picked && count === 0 && "opacity-50"
      )}
    >
      <span className={cn(picked && exclude && "line-through")}>
        {option.label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          picked && !exclude ? "text-background/70" : "text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
  );
}

/** The text a task must contain: its title, notes or a tag. Deferred tasks
 *  match it too, so a term never comes back empty for a task you put off. */
function TextCondition({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full max-w-sm">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Title, notes or tag contains…"
        aria-label="Text the task contains"
        className="h-7 w-full border border-border bg-transparent px-2 pr-7 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear text"
          className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <HiX className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** The kit's quiet action: a stencil slash and the word. */
function QuietAction({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        LABEL,
        "er-slash text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      )}
    >
      {children}
    </button>
  );
}
