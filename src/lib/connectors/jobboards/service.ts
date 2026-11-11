import type { ServiceManifest } from "@/lib/connectors/types";

/**
 * The public job boards most companies post to, read the way their careers
 * pages read them. No account.
 * Greenhouse: https://developers.greenhouse.io/job-board.html
 * Lever: https://github.com/lever/postings-api
 * Ashby: https://developers.ashbyhq.com/docs/public-job-posting-api
 */
export const JOB_BOARDS: ServiceManifest = {
  id: "jobboards",
  name: "Greenhouse, Lever and Ashby job boards",
  homepage: "https://developers.greenhouse.io/job-board.html",
  fields: [],
  host: {
    kind: "fixed",
    hosts: ["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com"],
  },
  egress: {
    to: "Greenhouse, Lever and Ashby (their public job board APIs)",
    sends: "The names of the companies' boards you follow",
    why: "To read the jobs those companies post, the way their careers pages do. Nothing is written back, and nothing applies for you.",
  },
};
