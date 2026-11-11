/**
 * Zotero's pull: top-level items with the reading tag (or in the chosen
 * collection) become "Read" tasks. Zotero has no "finished since" query, so
 * done detection reads the items Sigwald holds that dropped off the list, by
 * key (50 at a time): present without the tag means read, absent means
 * deleted or trashed, which the framework treats as gone.
 */
import {
  MAX_ITEM_KEYS,
  type ZoteroItem,
  itemsByKey,
  listQueue,
} from "@/lib/connectors/zotero/client";

import {
  type Fact,
  type PullFn,
  type PulledTask,
  fact,
  toDate,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

type Creator = NonNullable<ZoteroItem["data"]["creators"]>[number];

function creatorName(c: Creator): string {
  return (c.lastName || c.name || "").trim();
}

/** "Smith", "Smith and Jones", or "Smith et al.". Authors first, other roles only if there are none. */
export function authors(creators: readonly Creator[] | undefined): string {
  const list = creators ?? [];
  const authored = list.filter(
    (c) => !c.creatorType || c.creatorType === "author"
  );
  const names = (authored.length > 0 ? authored : list)
    .map(creatorName)
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} et al.`;
}

function yearOf(item: ZoteroItem): string {
  const text = item.meta?.parsedDate ?? item.data.date ?? "";
  return text.match(/\b(\d{4})\b/)?.[1] ?? "";
}

function linkOf(item: ZoteroItem, username: string, userID: string): string {
  const { url, DOI } = item.data;
  if (url) return url;
  if (DOI) return `https://doi.org/${DOI}`;
  return (
    item.links?.alternate?.href ??
    `https://www.zotero.org/${username || `users/${userID}`}/items/${item.key}`
  );
}

function hasTag(item: ZoteroItem, tag: string): boolean {
  const lower = tag.toLowerCase();
  return (item.data.tags ?? []).some((t) => t.tag.toLowerCase() === lower);
}

export const pullZotero: PullFn = async (ctx) => {
  const { http, secret, config, settings, now } = ctx;
  const userID = config.userID;
  const username = config.username ?? "";
  const tag = setting.text(settings, "tag").trim() || "to-read";
  const collection = setting.text(settings, "collection").trim();
  if (!userID) return { items: [], complete: false };

  const where = collection ? { collection } : { tag };
  const group = collection
    ? {
        key: `zotero:collection:${collection.toLowerCase()}`,
        label: `Collection ${collection}`,
      }
    : { key: `zotero:tag:${tag.toLowerCase()}`, label: tag };

  const queue = await listQueue(http, secret, userID, where);
  let complete = queue.complete;
  const open = new Map<string, PulledTask>();
  for (const item of queue.items) {
    if (item.data.itemType === "note" || item.data.itemType === "annotation") {
      continue;
    }
    const publication =
      item.data.publicationTitle ??
      item.data.bookTitle ??
      item.data.proceedingsTitle ??
      item.data.websiteTitle;
    const facts: Fact[] = [
      ...fact("Authors", authors(item.data.creators)),
      ...fact("Year", yearOf(item)),
      ...fact("Publication", publication),
    ];
    open.set(item.key, {
      kind: "task",
      externalId: item.key,
      title: `Read: ${item.data.title?.trim() || "Untitled"}`,
      state: "open",
      url: linkOf(item, username, userID),
      group,
      facts,
      updatedAt: toDate(item.data.dateModified),
    });
  }

  const missing = ctx.open.filter(
    (o) => o.kind === "task" && !open.has(o.externalId)
  );
  if (missing.length > MAX_ITEM_KEYS) complete = false;
  const titles = new Map(missing.map((o) => [o.externalId, o.title]));
  const held = await itemsByKey(
    http,
    secret,
    userID,
    missing.slice(0, MAX_ITEM_KEYS).map((o) => o.externalId)
  );
  const finished: PulledTask[] = [];
  for (const item of held) {
    const title = titles.get(item.key);
    if (title === undefined) continue;
    const stillQueued = collection
      ? (item.data.collections ?? []).includes(collection)
      : hasTag(item, tag);
    if (stillQueued) continue;
    finished.push({
      kind: "task",
      externalId: item.key,
      title,
      state: "done",
      doneAt: toDate(item.data.dateModified) ?? now,
    });
  }

  return { items: [...open.values(), ...finished], complete };
};
