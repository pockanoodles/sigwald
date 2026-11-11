/**
 * RSS 2.0, RSS 1.0 and Atom read into one shape. Pure: the text comes in
 * through the egress. A document that declares its own entities is refused
 * before parsing (feeds never need them, and expanding them is how an XML
 * bomb works); nothing external is ever fetched.
 */
import { XMLParser } from "fast-xml-parser";

import { ConnectorError } from "@/lib/connectors/errors";

export interface FeedEntry {
  /** The entry's own id (guid, Atom id), or its link. */
  id: string;
  title: string;
  link: string | null;
  published: Date | null;
  summary: string | null;
  authors: string[];
  categories: string[];
}

export interface Feed {
  title: string | null;
  entries: FeedEntry[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
  isArray: (name) =>
    ["item", "entry", "link", "author", "category", "creator"].includes(name),
});

type Node = unknown;

function textOf(node: Node): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string" || typeof node === "number")
    return String(node).trim() || null;
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    return textOf(o["#text"] ?? o.name ?? o["@_term"] ?? null);
  }
  return null;
}

/** A title on one line: feeds wrap long ones. */
function oneLine(node: Node): string | null {
  return textOf(node)?.replace(/\s+/g, " ") ?? null;
}

function list(node: Node): Node[] {
  if (node === null || node === undefined) return [];
  return Array.isArray(node) ? node : [node];
}

function date(node: Node): Date | null {
  const text = textOf(node);
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function atomLink(node: Node): string | null {
  const links = list(node).filter(
    (l): l is Record<string, unknown> => typeof l === "object" && l !== null
  );
  const alternate =
    links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  const href = alternate?.["@_href"];
  return typeof href === "string" ? href : textOf(node);
}

export function parseFeed(xml: string): Feed {
  if (/<!ENTITY/i.test(xml)) {
    throw new ConnectorError(
      "bad_response",
      "This feed declares entities of its own, which Sigwald won't read"
    );
  }
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new ConnectorError(
      "bad_response",
      "That address isn't a feed Sigwald can read"
    );
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const atom = doc.feed as Record<string, unknown> | undefined;
  const rdf = doc.RDF as Record<string, unknown> | undefined;

  if (atom) {
    return {
      title: oneLine(atom.title),
      entries: list(atom.entry).map((raw) => {
        const e = raw as Record<string, unknown>;
        const link = atomLink(e.link);
        return {
          id: textOf(e.id) ?? link ?? textOf(e.title) ?? "",
          title: oneLine(e.title) ?? "Untitled",
          link,
          published: date(e.published) ?? date(e.updated),
          summary: textOf(e.summary) ?? textOf(e.content),
          authors: list(e.author).flatMap((a) => textOf(a) ?? []),
          categories: list(e.category).flatMap((c) => textOf(c) ?? []),
        };
      }),
    };
  }

  const channel = (rss?.channel ?? rdf?.channel) as
    | Record<string, unknown>
    | undefined;
  const items = rss ? list(channel?.item) : rdf ? list(rdf.item) : null;
  if (!items)
    throw new ConnectorError(
      "bad_response",
      "That address isn't an RSS or Atom feed"
    );
  return {
    title: oneLine(channel?.title),
    entries: items.map((raw) => {
      const e = raw as Record<string, unknown>;
      const link = textOf(e.link);
      return {
        id: textOf(e.guid) ?? link ?? textOf(e.title) ?? "",
        title: oneLine(e.title) ?? "Untitled",
        link,
        published: date(e.pubDate) ?? date(e.date),
        summary: textOf(e.description) ?? textOf(e.encoded),
        authors: [...list(e.creator), ...list(e.author)].flatMap(
          (a) => textOf(a) ?? []
        ),
        categories: list(e.category).flatMap((c) => textOf(c) ?? []),
      };
    }),
  };
}
