import type { ServiceManifest } from "@/lib/connectors/types";

export const CALCOM: ServiceManifest = {
  id: "calcom",
  name: "Cal.com",
  homepage: "https://cal.com",
  tokenHelp: {
    text: "Make an API key in Cal.com under Settings, Developer, API keys. A key reads everything your account can, so Sigwald only asks for your bookings.",
    url: "https://app.cal.com/settings/developer/api-keys",
  },
  fields: [
    {
      key: "token",
      label: "API key",
      kind: "secret",
      placeholder: "cal_live_…",
      pattern: {
        source: "cal_[A-Za-z0-9_]{10,}",
        message: "A Cal.com API key starts with cal_",
      },
    },
  ],
  host: { kind: "fixed", hosts: ["api.cal.com"] },
  egress: {
    to: "Cal.com (api.cal.com)",
    sends:
      "Your API key, with requests for your upcoming and cancelled bookings",
    why: "To put the meetings people booked with you on your calendar as busy time, and take them off when they cancel. Nothing is written back.",
  },
};
