import type { ServiceManifest } from "@/lib/connectors/types";

export const MOODLE: ServiceManifest = {
  id: "moodle",
  name: "Moodle",
  homepage: "https://moodle.org",
  tokenHelp: {
    text: "On your Moodle site open Preferences, then Security keys, and copy the key for the Moodle mobile web service. It acts as you, and Sigwald only calls functions that read.",
    url: "https://docs.moodle.org/en/Security_keys",
  },
  fields: [
    {
      key: "site",
      label: "Moodle address",
      kind: "url",
      placeholder: "https://moodle.yourschool.edu",
      help: "The address you sign in to, without a path after it.",
    },
    {
      key: "token",
      label: "Security key",
      kind: "secret",
      placeholder: "32 letters and numbers",
      help: "The key for the Moodle mobile web service.",
      pattern: {
        source: "[A-Za-z0-9]{20,64}",
        message: "A Moodle key is letters and numbers only",
      },
    },
  ],
  host: { kind: "site", field: "site" },
  readsWithPost:
    "Moodle's web service takes the function name and your key as a form, so Sigwald sends it by POST; it only calls functions that read, and the key never sits in a URL.",
  egress: {
    to: "Your Moodle site",
    sends:
      "Your security key, with requests for your name, your upcoming assignment and quiz deadlines, and the submission status of each assignment you track",
    why: "To make a task for each assignment or quiz that is due, and finish it once you have submitted. Nothing is written back.",
  },
};
