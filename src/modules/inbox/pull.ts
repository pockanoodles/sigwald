/**
 * The Inbox never pulls: work is sent to its private address
 * (src/modules/inbox/routes.ts). It has a pull only because every connector
 * module does; its spec's `everyMinutes: 0` means it's never run.
 */
import type { PullFn } from "@/modules/connect/pull";

export const pullInbox: PullFn = async () => ({ items: [], complete: false });
