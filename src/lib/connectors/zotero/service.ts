import type { ServiceManifest } from "@/lib/connectors/types";

export const ZOTERO: ServiceManifest = {
  id: "zotero",
  name: "Zotero",
  homepage: "https://www.zotero.org",
  tokenHelp: {
    text: "Make a key in your Zotero account settings. Under Personal Library, allow Library access (read only) and leave Write access and Notes off.",
    url: "https://www.zotero.org/settings/keys/new",
  },
  fields: [
    {
      key: "key",
      label: "API key",
      kind: "secret",
    },
  ],
  host: { kind: "fixed", hosts: ["api.zotero.org"] },
  egress: {
    to: "Zotero (api.zotero.org)",
    sends:
      "Your API key, with requests for the items in your library that carry your reading tag",
    why: "To turn the papers you tagged to read into tasks, and see when you take the tag off. Nothing is written back.",
  },
};
