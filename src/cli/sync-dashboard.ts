#!/usr/bin/env ts-node
/**
 * sync-dashboard — pulls real data from Notion and pushes docs/live.json
 * to GitHub so the investor dashboard shows actual agent run history.
 *
 * Run manually:   npm run sync-dashboard
 * Also triggered: GitHub Actions on push + every 30 min (see .github/workflows/)
 */

import "dotenv/config";
import { Octokit } from "@octokit/rest";
import { getAgentMetrics } from "../tools/notion";
import { config } from "../config";
import type { AgentMetrics } from "../tools/types";
import type { AgentName, AgentLiveStatus, LiveData } from "../tools/live-status";

const octokit = new Octokit({ auth: config.github.token });
const { owner, repo } = config.github;
const FILE  = "docs/live.json";
const BRANCH = "main";

// ── Blank agent slot ──────────────────────────────────────────────────────────
function blank(): AgentLiveStatus {
  return {
    status: "idle", currentAction: "", iteration: 0,
    inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
    totalTokens: 0, costUsd: 0, durationMs: 0,
    startedAt: null, completedAt: null, taskTitle: "", release: "",
  };
}

// ── Fetch current file SHA ────────────────────────────────────────────────────
async function getCurrentSha(): Promise<string | undefined> {
  try {
    const res = await octokit.repos.getContent({ owner, repo, path: FILE, ref: BRANCH });
    return (res.data as { sha: string }).sha;
  } catch {
    return undefined;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 Fetching metrics from Notion…");

  // Read all metrics rows from Notion
  const result = await getAgentMetrics();
  const metrics: AgentMetrics[] = result.success ? (result.data as AgentMetrics[]) : [];

  if (!result.success) {
    console.warn("⚠️  Could not read metrics:", result.error);
    console.warn("    Make sure NOTION_METRICS_DB_ID is set in .env / GitHub Secrets.");
  }

  console.log("   Found " + metrics.length + " metric row(s).");

  // Build per-agent last-run snapshot
  const agentNames: AgentName[] = ["PM/PO", "SE", "QA"];
  const agents: Record<AgentName, AgentLiveStatus> = {
    "PM/PO": blank(),
    "SE":    blank(),
    "QA":    blank(),
  };

  for (const name of agentNames) {
    const runs = metrics.filter(m => m.agentName === name);
    if (!runs.length) continue;

    // Most recent run is first (Notion sorts by created_time desc)
    const latest = runs[0];
    agents[name] = {
      status: latest.status === "completed" ? "completed"
            : latest.status === "failed"    ? "failed"
            : "idle",
      currentAction: latest.status === "completed"
        ? "Last run completed — " + latest.taskTitle.slice(0, 60)
        : latest.status === "failed"
        ? "Last run failed"
        : "Last run: " + latest.taskTitle.slice(0, 60),
      iteration: 0,
      inputTokens:    latest.inputTokens,
      outputTokens:   latest.outputTokens,
      thinkingTokens: latest.thinkingTokens,
      totalTokens:    latest.totalTokens,
      costUsd:        latest.costUsd,
      durationMs:     latest.durationMs,
      startedAt:      latest.timestamp,
      completedAt:    latest.timestamp,
      taskTitle:      latest.taskTitle,
      release:        latest.releaseId,
    };
  }

  // Build history list (all runs, latest first)
  const history = metrics.slice(0, 20).map(m => ({
    agent:       m.agentName,
    taskTitle:   m.taskTitle,
    status:      (m.status === "completed" ? "completed" : "failed") as "completed" | "failed",
    totalTokens: m.totalTokens,
    costUsd:     m.costUsd,
    durationMs:  m.durationMs,
    completedAt: m.timestamp,
  }));

  const live: LiveData = {
    updatedAt: new Date().toISOString(),
    agents,
    history,
  };

  // Push to GitHub
  console.log("📤 Pushing docs/live.json to GitHub…");
  const sha  = await getCurrentSha();
  const b64  = Buffer.from(JSON.stringify(live, null, 2)).toString("base64");
  const msg  = "sync: dashboard data from Notion (" + metrics.length + " run" + (metrics.length !== 1 ? "s" : "") + ")";

  await octokit.repos.createOrUpdateFileContents({
    owner, repo,
    path:    FILE,
    message: msg,
    content: b64,
    branch:  BRANCH,
    sha,
  });

  console.log("✅ Dashboard updated.");

  // Summary
  const total = { tok: 0, cost: 0 };
  metrics.forEach(m => { total.tok += m.totalTokens; total.cost += m.costUsd; });
  console.log("   Total tokens across all runs: " + total.tok.toLocaleString());
  console.log("   Total cost:  $" + total.cost.toFixed(4));
}

main().catch(err => { console.error("sync-dashboard failed:", err); process.exit(1); });
