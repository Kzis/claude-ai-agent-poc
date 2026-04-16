#!/usr/bin/env ts-node
/**
 * sync-dashboard - pulls real data from all Notion databases and pushes
 * docs/live.json to GitHub so the investor dashboard shows actual activity.
 *
 * Priority:
 *   1. If the metrics DB has rows  → use precise token/cost/duration data
 *   2. If metrics DB is empty      → derive agent stats from backlog/bugs/releases
 *
 * Run manually:   npm run sync-dashboard
 * Also triggered: GitHub Actions on every push + every 30 min
 */

import "dotenv/config";
import { Octokit } from "@octokit/rest";
import { getAgentMetrics, getTasks, getBugReports, getReleases } from "../tools/notion";
import { config } from "../config";
import type { AgentMetrics, Task, BugReport, Release } from "../tools/types";
import type { AgentName, AgentLiveStatus, LiveData } from "../tools/live-status";

const octokit = new Octokit({ auth: config.github.token });
const { owner, repo } = config.github;
const FILE   = "docs/live.json";
const BRANCH = "main";

function blank(): AgentLiveStatus {
  return {
    status: "idle", currentAction: "", iteration: 0,
    inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
    totalTokens: 0, costUsd: 0, durationMs: 0,
    startedAt: null, completedAt: null, taskTitle: "", release: "",
  };
}

async function getCurrentSha(): Promise<string | undefined> {
  try {
    const res = await octokit.repos.getContent({ owner, repo, path: FILE, ref: BRANCH });
    return (res.data as { sha: string }).sha;
  } catch { return undefined; }
}

// ── Build agent stats from raw Notion data (no metrics rows yet) ──────────────
function deriveFromNotion(
  tasks: Task[],
  bugs: BugReport[],
  releases: Release[]
): { agents: Record<AgentName, AgentLiveStatus>; history: LiveData["history"] } {

  const latestRelease = releases.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  const releaseName = latestRelease?.name ?? "Release-1";

  const done       = tasks.filter(t => t.status === "Done");
  const inProgress = tasks.filter(t => t.status === "In Progress");
  const backlog    = tasks.filter(t => t.status === "Backlog");
  const withPR     = done.filter(t => t.prUrl);
  const openBugs   = bugs.filter(b => b.status === "Open");
  const closedBugs = bugs.filter(b => b.status !== "Open");

  // Oldest created_time as proxy for "when the agent ran"
  const oldestTask = [...tasks].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )[0];
  const newestDone = [...done].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0];

  const agents: Record<AgentName, AgentLiveStatus> = {
    "PM/PO": {
      ...blank(),
      status: tasks.length > 0 ? "completed" : "idle",
      currentAction: tasks.length > 0
        ? `Created ${tasks.length} tasks - ${done.length} done, ${inProgress.length} in progress, ${backlog.length} backlog`
        : "No tasks yet",
      taskTitle: latestRelease?.name ?? "",
      release: releaseName,
      startedAt:   oldestTask?.createdAt ?? null,
      completedAt: oldestTask?.createdAt ?? null,
      iteration: tasks.length,
    },
    "SE": {
      ...blank(),
      status: done.length > 0 ? "completed" : inProgress.length > 0 ? "running" : "idle",
      currentAction: withPR.length > 0
        ? `Shipped ${withPR.length} task${withPR.length !== 1 ? "s" : ""} with PRs - latest: ${(newestDone?.title ?? "").slice(0, 50)}`
        : done.length > 0
        ? `Completed ${done.length} task${done.length !== 1 ? "s" : ""}`
        : inProgress.length > 0
        ? `Working on: ${inProgress[0]?.title?.slice(0, 60) ?? ""}`
        : "No tasks picked up yet",
      taskTitle: newestDone?.title ?? inProgress[0]?.title ?? "",
      release: newestDone?.release ?? releaseName,
      startedAt:   newestDone?.updatedAt ?? null,
      completedAt: newestDone?.updatedAt ?? null,
      iteration: done.length + inProgress.length,
    },
    "QA": {
      ...blank(),
      status: bugs.length > 0 || done.length > 0 ? "completed" : "idle",
      currentAction: bugs.length > 0
        ? `Reviewed ${done.length} task${done.length !== 1 ? "s" : ""} - filed ${bugs.length} bug${bugs.length !== 1 ? "s" : ""} (${openBugs.length} open, ${closedBugs.length} closed)`
        : done.length > 0
        ? `Reviewed ${done.length} task${done.length !== 1 ? "s" : ""} - no bugs filed`
        : "No tasks reviewed yet",
      taskTitle: latestRelease?.name
        ? `QA review - ${latestRelease.name}`
        : "QA review",
      release: releaseName,
      startedAt:   newestDone?.updatedAt ?? null,
      completedAt: newestDone?.updatedAt ?? null,
      iteration: done.length,
    },
  };

  // Synthesise history from releases
  const history: LiveData["history"] = releases
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .flatMap(r => {
      const relTasks = tasks.filter(t => t.release === r.name);
      const relDone  = relTasks.filter(t => t.status === "Done").length;
      return [
        { agent: "PM/PO" as AgentName, taskTitle: `Sprint planning - ${r.name} (${relTasks.length} tasks)`, status: "completed" as const, totalTokens: 0, costUsd: 0, durationMs: 0, completedAt: r.createdAt },
        { agent: "SE"    as AgentName, taskTitle: `Implemented ${relDone} task${relDone !== 1 ? "s" : ""} - ${r.name}`, status: "completed" as const, totalTokens: 0, costUsd: 0, durationMs: 0, completedAt: r.createdAt },
        { agent: "QA"    as AgentName, taskTitle: `QA review - ${r.name} (${r.status})`, status: r.status === "Released" || r.status === "In Progress" ? "completed" as const : "completed" as const, totalTokens: 0, costUsd: 0, durationMs: 0, completedAt: r.createdAt },
      ];
    });

  return { agents, history };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 Fetching data from Notion…");

  const [metricsRes, tasksRes, bugsRes, releasesRes] = await Promise.all([
    getAgentMetrics(),
    getTasks(),
    getBugReports(),
    getReleases(),
  ]);

  const metrics:  AgentMetrics[] = metricsRes.success  ? (metricsRes.data  as AgentMetrics[]) : [];
  const tasks:    Task[]         = tasksRes.success     ? (tasksRes.data    as Task[])         : [];
  const bugs:     BugReport[]    = bugsRes.success      ? (bugsRes.data     as BugReport[])    : [];
  const releases: Release[]      = releasesRes.success  ? (releasesRes.data as Release[])      : [];

  console.log(`   metrics: ${metrics.length} | tasks: ${tasks.length} | bugs: ${bugs.length} | releases: ${releases.length}`);

  let agents: Record<AgentName, AgentLiveStatus>;
  let history: LiveData["history"];

  if (metrics.length > 0) {
    // ── Use precise metrics data ──────────────────────────────────────────────
    console.log("   Using metrics DB rows for agent stats.");
    const agentNames: AgentName[] = ["PM/PO", "SE", "QA"];
    agents = { "PM/PO": blank(), "SE": blank(), "QA": blank() };

    for (const name of agentNames) {
      const runs = metrics.filter(m => m.agentName === name);
      if (!runs.length) continue;
      const latest = runs[0];
      agents[name] = {
        status:        latest.status === "completed" ? "completed" : latest.status === "failed" ? "failed" : "idle",
        currentAction: latest.status === "completed" ? `Last run: ${latest.taskTitle.slice(0, 60)}` : "Last run failed",
        iteration:     0,
        inputTokens:   latest.inputTokens,
        outputTokens:  latest.outputTokens,
        thinkingTokens:latest.thinkingTokens,
        totalTokens:   latest.totalTokens,
        costUsd:       latest.costUsd,
        durationMs:    latest.durationMs,
        startedAt:     latest.timestamp,
        completedAt:   latest.timestamp,
        taskTitle:     latest.taskTitle,
        release:       latest.releaseId,
      };
    }

    history = metrics.slice(0, 20).map(m => ({
      agent:       m.agentName,
      taskTitle:   m.taskTitle,
      status:      (m.status === "completed" ? "completed" : "failed") as "completed" | "failed",
      totalTokens: m.totalTokens,
      costUsd:     m.costUsd,
      durationMs:  m.durationMs,
      completedAt: m.timestamp,
    }));

  } else {
    // ── Derive from backlog / bugs / releases ─────────────────────────────────
    console.log("   Metrics DB empty - deriving stats from backlog data.");
    ({ agents, history } = deriveFromNotion(tasks, bugs, releases));
  }

  const live: LiveData = { updatedAt: new Date().toISOString(), agents, history };

  console.log("📤 Pushing docs/live.json to GitHub…");
  const sha = await getCurrentSha();
  const b64 = Buffer.from(JSON.stringify(live, null, 2)).toString("base64");

  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path: FILE, branch: BRANCH, sha,
    message: `sync: ${metrics.length} metric run(s), ${tasks.length} tasks, ${bugs.length} bugs`,
    content: b64,
  });

  console.log("✅ Done.");
  console.log(`   Tasks: ${tasks.length} (${tasks.filter(t=>t.status==="Done").length} done)`);
  console.log(`   Bugs: ${bugs.length} (${bugs.filter(b=>b.status==="Open").length} open)`);
  console.log(`   Releases: ${releases.map(r=>r.name+"="+r.status).join(", ")}`);
}

main().catch(err => { console.error("sync-dashboard failed:", err); process.exit(1); });
