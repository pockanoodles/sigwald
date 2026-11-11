import type { ServiceManifest } from "@/lib/connectors/types";

export const WORDPRESS: ServiceManifest = {
  id: "wordpress",
  name: "WordPress",
  homepage: "https://wordpress.org",
  tokenHelp: {
    text: "For a self-hosted WordPress (5.6 or later) with Application Passwords, not WordPress.com. In wp-admin open Users, edit your profile and add a new Application Password. Use an account that is an Author or below: it can read your own posts and nothing more.",
    url: "https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/",
  },
  fields: [
    {
      key: "site",
      label: "Site address",
      kind: "url",
      placeholder: "https://example.com",
      help: "The address of your WordPress site, with its folder if it lives in one.",
    },
    {
      key: "username",
      label: "Username",
      kind: "text",
      help: "Your WordPress login name.",
    },
    {
      key: "appPassword",
      label: "Application Password",
      kind: "secret",
      placeholder: "abcd efgh ijkl mnop qrst uvwx",
      help: "Spaces are fine.",
    },
  ],
  host: { kind: "site", field: "site" },
  egress: {
    to: "Your WordPress site",
    sends:
      "Your username and Application Password, with requests for your drafts, pending and scheduled posts",
    why: "To make a task for each draft and each post waiting for review, a calendar event for each scheduled post, and finish a task once its post is published. Nothing is written back.",
  },
};
