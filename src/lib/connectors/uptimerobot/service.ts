import type { ServiceManifest } from "@/lib/connectors/types";

export const UPTIMEROBOT: ServiceManifest = {
  id: "uptimerobot",
  name: "UptimeRobot",
  homepage: "https://uptimerobot.com",
  tokenHelp: {
    text: "In UptimeRobot open Integrations, then the API section, and make a read-only API key. A read-only key can list your monitors and their uptime and change nothing.",
    url: "https://dashboard.uptimerobot.com/integrations",
  },
  fields: [
    {
      key: "key",
      label: "Read-only API key",
      kind: "secret",
      placeholder: "Your read-only API key",
    },
  ],
  host: { kind: "fixed", hosts: ["api.uptimerobot.com"] },
  egress: {
    to: "UptimeRobot (api.uptimerobot.com)",
    sends:
      "Your read-only API key, with requests for your account, your monitors and their uptime over 30 days",
    why: "To make a task for each monitor that is down, finish it once the monitor is up again, and show how many monitors are up and their average uptime. Nothing is written back.",
  },
};
