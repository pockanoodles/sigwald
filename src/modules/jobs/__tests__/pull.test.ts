import { fakeServiceHttp } from "@/lib/connectors/__tests__/fake-http";
import { JOB_BOARDS } from "@/lib/connectors/jobboards/service";

import type { PullContext, PulledTask } from "@/modules/connect/pull";
import { resolveSettings } from "@/modules/connect/settings";
import jobs from "@/modules/jobs/manifest";
import { pullJobs } from "@/modules/jobs/pull";

const ctx = (
  http: PullContext["http"],
  settings: Record<string, unknown>
): PullContext => ({
  http,
  secret: {},
  config: {},
  settings: resolveSettings(jobs.connect!.settings, settings),
  now: new Date("2026-11-11T15:00:00.000Z"),
  timeZone: "UTC",
  cursor: null,
  open: [],
  lastSuccessAt: null,
});

// Shaped as each board answered on 2026-11-11.
const greenhouse = {
  jobs: [
    {
      id: 8172508,
      title: "Software Engineer, New Grad",
      location: { name: "Seattle" },
      absolute_url: "https://stripe.com/jobs/search?gh_jid=8172508",
      updated_at: "2026-10-29T10:42:09-04:00",
      first_published: "2026-09-03T13:32:53-04:00",
    },
    {
      id: 2,
      title: "Abuse Investigator",
      location: { name: "Dublin" },
      absolute_url: "https://stripe.com/x",
      updated_at: null,
    },
  ],
  meta: { total: 2 },
};
const lever = [
  {
    id: "6ed76ce8-4156-4b60-b120-403538bd66cd",
    text: "Software Engineer, New Grad - Infrastructure",
    categories: {
      commitment: "Full-time",
      location: "New York, NY",
      team: "Dev",
      allLocations: ["New York, NY"],
    },
    hostedUrl: "https://jobs.lever.co/palantir/6ed76ce8",
    createdAt: 1786469891368,
    workplaceType: "onsite",
  },
];
const ashby = {
  apiVersion: "1",
  jobs: [
    {
      id: "d3bc1ced",
      title: "New Grad Engineer",
      location: "Europe",
      team: "Engineering",
      jobUrl: "https://jobs.ashbyhq.com/linear/d3bc1ced",
      publishedAt: "2026-04-27T20:13:45.158+00:00",
      isListed: true,
      isRemote: true,
      workplaceType: "Remote",
    },
    {
      id: "hidden",
      title: "New Grad (unlisted)",
      location: "",
      jobUrl: "https://x",
      isListed: false,
    },
  ],
};

const routes = [
  {
    url: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs",
    json: greenhouse,
  },
  { url: "https://api.lever.co/v0/postings/palantir", json: lever },
  { url: "https://api.ashbyhq.com/posting-api/job-board/linear", json: ashby },
];

describe("pullJobs", () => {
  it("makes an Apply task for each matching opening across the three boards", async () => {
    const { http } = fakeServiceHttp(JOB_BOARDS, routes);
    const result = await pullJobs(
      ctx(http, {
        boards: ["greenhouse:stripe", "lever:palantir", "ashby:linear"],
        words: ["new grad"],
      })
    );
    const tasks = result.items as PulledTask[];
    expect(tasks.map((t) => t.title)).toEqual([
      "Apply: Software Engineer, New Grad at Stripe",
      "Apply: Software Engineer, New Grad - Infrastructure at Palantir",
      "Apply: New Grad Engineer at Linear",
    ]);
    expect(tasks[0]).toMatchObject({
      externalId: "greenhouse:stripe:8172508",
      url: "https://stripe.com/jobs/search?gh_jid=8172508",
      group: { key: "jobs:board:greenhouse:stripe", label: "Stripe" },
    });
    expect(result.complete).toBe(true);
  });

  it("keeps to the places asked for, remote included", async () => {
    const { http } = fakeServiceHttp(JOB_BOARDS, routes);
    const result = await pullJobs(
      ctx(http, {
        boards: ["greenhouse:stripe", "lever:palantir", "ashby:linear"],
        words: ["new grad"],
        places: ["new york", "remote"],
      })
    );
    expect(result.items.map((i) => i.externalId)).toEqual([
      "lever:palantir:6ed76ce8-4156-4b60-b120-403538bd66cd",
      "ashby:linear:d3bc1ced",
    ]);
  });

  it("keeps the other boards' openings when one board fails, and says so", async () => {
    const { http } = fakeServiceHttp(JOB_BOARDS, [
      routes[0],
      {
        url: "https://api.lever.co/v0/postings/gone",
        status: 404,
        json: { ok: false, error: "Document not found" },
      },
    ]);
    const result = await pullJobs(
      ctx(http, {
        boards: ["greenhouse:stripe", "lever:gone"],
        words: ["new grad"],
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.complete).toBe(false);
  });
});
