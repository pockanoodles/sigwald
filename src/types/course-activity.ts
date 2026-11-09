/** Client shapes for the course activity and news APIs (src/app/api/sigwald/{activity,news}). */

export type ActivityKind =
  | "ANNOUNCEMENT"
  | "MESSAGE"
  | "MATERIAL_NEW"
  | "MATERIAL_UPDATED"
  | "SYLLABUS_CHANGED"
  | "ASSIGNMENT_NEW"
  | "DUE_CHANGED"
  | "GRADE_POSTED"
  | "GRADE_CHANGED"
  | "FEEDBACK"
  | "MISSING"
  | "CORRECTION_RETIRED";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  occurredAt: string;
  createdAt: string;
  seenAt: string | null;
  course: { id: string; canvasId: string; code: string | null; name: string };
  /** What opening the row shows. At most one is set besides `taskId`. */
  target: {
    materialId: string | null;
    assignmentId: string | null;
    taskId: string | null;
    announcementId: string | null;
    conversationId: string | null;
    /** The same thing in Canvas, when Sigwald has no copy of it. */
    htmlUrl: string | null;
  };
}

export interface ActivityFeed {
  items: ActivityItem[];
  unseenCount: number;
}

export interface NewsCourse {
  id: string;
  /** Canvas's id, which goals claim a course by (`course:<canvasId>`). */
  canvasId: string;
  code: string | null;
  name: string;
}

export interface NewsAnnouncement {
  type: "announcement";
  id: string;
  course: NewsCourse;
  title: string;
  author: string | null;
  at: string;
  htmlUrl: string | null;
  /** Sanitized server-side; safe to inject. */
  bodyHtml: string;
  readInCanvas: boolean;
  unseen: boolean;
}

export interface NewsMessage {
  type: "message";
  id: string;
  course: NewsCourse;
  title: string;
  author: string | null;
  at: string;
  messages: Array<{ id: string; author: string | null; body: string; createdAt: string; mine: boolean }>;
  unseen: boolean;
}

export type NewsItem = NewsAnnouncement | NewsMessage;
