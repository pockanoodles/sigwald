/**
 * The three public job board APIs, read into one shape.
 * Greenhouse: GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs
 *   (https://developers.greenhouse.io/job-board.html#list-jobs)
 * Lever: GET https://api.lever.co/v0/postings/{site}?mode=json
 *   (https://github.com/lever/postings-api#get-a-list-of-job-postings)
 * Ashby: GET https://api.ashbyhq.com/posting-api/job-board/{board}
 *   (https://developers.ashbyhq.com/docs/public-job-posting-api)
 */
import type { Http } from "@/lib/connectors/egress";
import { ConnectorError, isConnectorError } from "@/lib/connectors/errors";

export type BoardKind = "greenhouse" | "lever" | "ashby";

export interface Posting {
  id: string;
  title: string;
  location: string;
  team: string | null;
  url: string;
  postedAt: string | null;
  remote: boolean;
}

interface GreenhouseJobs {
  jobs: {
    id: number;
    title: string;
    location: { name: string } | null;
    absolute_url: string;
    updated_at: string | null;
    first_published?: string | null;
  }[];
}

interface LeverPosting {
  id: string;
  text: string;
  categories: {
    location?: string;
    team?: string;
    commitment?: string;
    allLocations?: string[];
  };
  hostedUrl: string;
  createdAt: number;
  workplaceType?: string;
}

interface AshbyBoard {
  jobs: {
    id: string;
    title: string;
    location: string;
    team?: string;
    department?: string;
    jobUrl: string;
    publishedAt?: string;
    isListed?: boolean;
    isRemote?: boolean;
    workplaceType?: string;
  }[];
}

export async function postings(
  http: Http,
  kind: BoardKind,
  board: string
): Promise<Posting[]> {
  const name = encodeURIComponent(board);
  try {
    if (kind === "greenhouse") {
      const res = await http.json<GreenhouseJobs>(
        `https://boards-api.greenhouse.io/v1/boards/${name}/jobs`
      );
      return res.jobs.map((j) => ({
        id: String(j.id),
        title: j.title,
        location: j.location?.name ?? "",
        team: null,
        url: j.absolute_url,
        postedAt: j.first_published ?? j.updated_at ?? null,
        remote: /remote/i.test(j.location?.name ?? ""),
      }));
    }
    if (kind === "lever") {
      const res = await http.json<LeverPosting[]>(
        `https://api.lever.co/v0/postings/${name}?mode=json`
      );
      return res.map((p) => ({
        id: p.id,
        title: p.text,
        location:
          p.categories.allLocations?.join(" · ") || p.categories.location || "",
        team: p.categories.team ?? null,
        url: p.hostedUrl,
        postedAt: Number.isFinite(p.createdAt)
          ? new Date(p.createdAt).toISOString()
          : null,
        remote:
          p.workplaceType === "remote" ||
          /remote/i.test(p.categories.location ?? ""),
      }));
    }
    const res = await http.json<AshbyBoard>(
      `https://api.ashbyhq.com/posting-api/job-board/${name}`
    );
    return res.jobs
      .filter((j) => j.isListed !== false)
      .map((j) => ({
        id: j.id,
        title: j.title,
        location: j.location,
        team: j.team ?? j.department ?? null,
        url: j.jobUrl,
        postedAt: j.publishedAt ?? null,
        remote: j.isRemote === true || j.workplaceType === "Remote",
      }));
  } catch (error) {
    if (isConnectorError(error) && error.kind === "not_found") {
      throw new ConnectorError(
        "config",
        `There's no ${kind} board called ${board}.`
      );
    }
    throw error;
  }
}
