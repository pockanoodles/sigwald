import type { ServiceManifest } from "@/lib/connectors/types";

export const PAGERDUTY: ServiceManifest = {
  id: "pagerduty",
  name: "PagerDuty",
  homepage: "https://www.pagerduty.com",
  tokenHelp: {
    text: "Make a user API token under My Profile, User Settings, Create API User Token. It has your own access and nothing more; an account-wide key does not work because Sigwald needs to know who you are.",
    url: "https://support.pagerduty.com/main/docs/api-access-keys#generate-a-user-token-rest-api-key",
  },
  fields: [
    {
      key: "token",
      label: "User API token",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["api.pagerduty.com"] },
  egress: {
    to: "PagerDuty (api.pagerduty.com)",
    sends:
      "Your API token, with requests for your on-call shifts and the incidents assigned to you",
    why: "To put your on-call shifts on the calendar and make a task for each incident waiting on you, and see when they're resolved. Nothing is written back.",
  },
};
