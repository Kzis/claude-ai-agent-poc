/**
 * Agent Metrics — write + read helper used by all three agents.
 *
 * Agents import this module dynamically so it won't crash if
 * NOTION_METRICS_DB_ID is missing (they catch the error).
 */

import "dotenv/config";
import { createAgentMetric, getAgentMetrics } from "./notion";
import type { AgentMetrics } from "./types";

export { calculateCost } from "./types";

export async function createMetric(metric: AgentMetrics): Promise<void> {
  const result = await createAgentMetric(metric);
  if (!result.success) {
    console.warn("[metrics] Failed to write metric:", result.error);
  }
}

export async function getMetrics(filter?: {
  releaseId?: string;
  agentName?: string;
}): Promise<AgentMetrics[]> {
  const result = await getAgentMetrics(filter);
  if (!result.success) {
    console.warn("[metrics] Failed to read metrics:", result.error);
    return [];
  }
  return result.data as AgentMetrics[];
}
