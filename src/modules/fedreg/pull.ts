/**
 * Federal Register's pull: documents matching the words (and agencies)
 * whose comment period hasn't closed, newest first. Once a period closes the
 * document stops matching, and its task closes undone.
 * Docs: https://www.federalregister.gov/developers/documentation/api/v1#/Federal%20Register%20Documents/get_documents__format_
 */
import { dayIn } from "@/lib/date-utils";

import {
  type PullFn,
  type PulledTask,
  dueDay,
  fact,
  plainText,
} from "@/modules/connect/pull";
import { setting } from "@/modules/connect/settings";

interface FedRegDocument {
  document_number: string;
  title: string;
  type: string;
  abstract: string | null;
  html_url: string;
  publication_date: string;
  comments_close_on: string | null;
  agencies: { name?: string; raw_name?: string; slug?: string }[];
}

const PER_PAGE = 50;

export const pullFedreg: PullFn = async ({ http, settings, now, timeZone }) => {
  const agencies = setting.list(settings, "agencies");
  const types = setting.text(settings, "types").split(",").filter(Boolean);
  const res = await http.json<{ count: number; results?: FedRegDocument[] }>({
    url: "https://www.federalregister.gov/api/v1/documents.json",
    query: {
      "conditions[term]": setting.text(settings, "terms"),
      "conditions[agencies][]": agencies,
      "conditions[type][]": types,
      "conditions[comment_date][gte]": dayIn(now, timeZone),
      "fields[]": [
        "document_number",
        "title",
        "type",
        "abstract",
        "html_url",
        "publication_date",
        "comments_close_on",
        "agencies",
      ],
      per_page: PER_PAGE,
      order: "newest",
    },
  });

  const items: PulledTask[] = (res.results ?? []).flatMap((d) => {
    if (!d.comments_close_on) return [];
    const agency = d.agencies.find((a) => a.slug && a.name) ?? null;
    return [
      {
        kind: "task" as const,
        externalId: d.document_number,
        title: `Comment on: ${d.title}`,
        state: "open" as const,
        url: d.html_url,
        description: plainText(d.abstract, 1500),
        due: dueDay(d.comments_close_on),
        group: agency
          ? { key: `fedreg:agency:${agency.slug}`, label: agency.name! }
          : null,
        facts: [
          ...fact(
            "Agencies",
            d.agencies
              .map((a) => a.name ?? a.raw_name)
              .filter(Boolean)
              .join(", ")
          ),
          ...fact("Type", d.type),
          ...fact("Published", d.publication_date),
          ...fact("Comments close", d.comments_close_on),
          ...fact("Document", d.document_number),
        ],
      },
    ];
  });
  return { items, complete: res.count <= PER_PAGE };
};
