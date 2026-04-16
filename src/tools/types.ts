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

// ─── Agent Metrics ────────────────────────────────────────────────────────────

export type AgentName = "PM/PO" | "SE" | "QA";
export type MetricStatus = "started" | "completed" | "failed";

export interface AgentMetrics {
  id?: string;            // Notion page ID (set after write)
  agentName: AgentName;
  taskId: string;
  taskTitle: string;
  status: MetricStatus;
  model: string;          // e.g. "claude-opus-4-6"
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  costUsd: number;        // calculated: (inputTokens * 0.000015) + ((outputTokens + thinkingTokens) * 0.000075)
  durationMs: number;
  releaseId: string;      // e.g. "Release-2"
  timestamp: string;      // ISO 8601
  notes?: string;         // optional thinking summary or work log
}

/**
 * Calculate the cost in USD for a Claude claude-sonnet-4-6 invocation.
 * Pricing: $3/M input tokens, $15/M output tokens.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  thinkingTokens: number
): number {
  return (inputTokens * 0.000003) + ((outputTokens + thinkingTokens) * 0.000015);
}
