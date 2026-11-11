import { WORDPRESS } from "@/lib/connectors/wordpress/service";

import { maxOpenField } from "@/modules/connect/spec";
import type { ModuleManifest } from "@/modules/types";

const wordpress: ModuleManifest = {
  id: "wordpress",
  name: "WordPress",
  summary:
    "Your drafts and posts awaiting review as tasks, and scheduled posts on the calendar. For self-hosted WordPress with Application Passwords, not WordPress.com.",
  defaultOn: false,
  beta: true,
  shelf: "writing",
  madeFor: ["Bloggers", "Writers", "Site editors"],
  sources: ["WORDPRESS"],
  linkLabels: { WORDPRESS: "Edit in WordPress" },
  claimLabels: { WORDPRESS: "All WordPress posts" },
  adds: [
    "A task for each draft of yours, and one to review each post that is pending",
    "A calendar event at the time each of your scheduled posts goes out",
    "Finished when the post is published, so the goals that claim your site earn for it",
  ],
  keeps:
    "For each of your drafts, pending and scheduled posts: its title, link and the times it was edited and set to publish. Never the text of a post.",
  egress: [WORDPRESS.egress],
  connect: {
    service: WORDPRESS,
    makes: ["tasks", "events"],
    everyMinutes: 30,
    settings: [maxOpenField(20)],
  },
};

export default wordpress;
