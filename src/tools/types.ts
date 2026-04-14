// ─── Backlog / Task ───────────────────────────────────────────────────────────

export type TaskStatus =
  | "Backlog"
  | "In Progress"
  | "In Review"
  | "QA"
  | "Done"
  | "Blocked";

export type TaskPriority = "Critical" | "High" | "Medium" | "Low";
export type TaskType = "Feature" | "Bug Fix" | "Chore" | "Research";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  assignee: string;
  release: string;
  workLog: string;
  prUrl: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Bug Report ───────────────────────────────────────────────────────────────

export type BugSeverity = "Critical" | "High" | "Medium" | "Low";
export type BugStatus = "Open" | "In Progress" | "Fixed" | "Closed" | "Wont Fix";

export interface BugReport {
  id: string;
  title: string;
  description: string;
  stepsToReproduce: string;
  severity: BugSeverity;
  status: BugStatus;
  relatedTaskId: string;
  release: string;
  createdAt: string;
}

// ─── Release ──────────────────────────────────────────────────────────────────

export type ReleaseStatus = "Planning" | "In Progress" | "Released" | "Cancelled";

export interface Release {
  id: string;
  name: string;
  version: string;
  status: ReleaseStatus;
  features: string;
  bugCount: number;
  releaseNotes: string;
  createdAt: string;
}

// ─── Agent Tool Results ───────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  branch: string;
  state: "open" | "closed" | "merged";
}
