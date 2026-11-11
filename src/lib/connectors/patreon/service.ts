import type { ServiceManifest } from "@/lib/connectors/types";

export const PATREON: ServiceManifest = {
  id: "patreon",
  name: "Patreon",
  homepage: "https://www.patreon.com",
  tokenHelp: {
    text: "Register a client on Patreon's API page and copy its Creator's Access Token. It reads your own campaign and your profile name. It needs a creator account.",
    url: "https://www.patreon.com/portal/registration/register-clients",
  },
  fields: [
    {
      key: "token",
      label: "Creator's Access Token",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["www.patreon.com"] },
  egress: {
    to: "Patreon (www.patreon.com)",
    sends:
      "Your access token, with requests for your name and your campaign's patron count",
    why: "To show how many patrons you have as a number. Nothing is written back.",
  },
};
