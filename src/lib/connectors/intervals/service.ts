import type { ServiceManifest } from "@/lib/connectors/types";

export const INTERVALS: ServiceManifest = {
  id: "intervals",
  name: "Intervals.icu",
  homepage: "https://intervals.icu",
  tokenHelp: {
    text: "Open Settings in Intervals.icu, scroll to Developer Settings and make an API key. Your athlete id is on the same page, and starts with i. The key reads and writes your own data, so Sigwald only sends reads.",
    url: "https://intervals.icu/settings",
  },
  fields: [
    {
      key: "athleteId",
      label: "Athlete id",
      kind: "text",
      placeholder: "i12345",
      help: "Shown under Developer Settings.",
      pattern: {
        source: "i?[0-9]{1,12}",
        message: "An athlete id is a number, usually with an i in front",
      },
    },
    {
      key: "key",
      label: "API key",
      kind: "secret",
      placeholder: "Your API key",
    },
  ],
  host: { kind: "fixed", hosts: ["intervals.icu"] },
  egress: {
    to: "Intervals.icu (intervals.icu)",
    sends:
      "Your API key, with your athlete id in requests for your profile, your planned workouts for the next 14 days and today's fitness numbers",
    why: "To make a task for each planned workout, finish it once an activity is matched to it, and show your fitness, fatigue and form. Nothing is written back.",
  },
};
