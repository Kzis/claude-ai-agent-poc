#!/usr/bin/env ts-node
/**
 * Investor Dashboard — http://localhost:3000
 * Serves a live HTML dashboard showing agent activity, metrics,
 * token usage, costs, and backlog status for Release 2.
 *
 * Run:  npm run dashboard
 */

import "dotenv/config";
import * as http from "http";
import { getMetrics } from "../tools/metrics";
import { getTasks, getBugReports, getReleases } from "../tools/notion";
import type { AgentMetrics } from "../tools/types";

const PORT = 3000;

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchDashboardData() {
  const [metricsResult, tasksResult, bugsResult, releasesResult] = await Promise.allSettled([
    getMetrics(),
    getTasks(),
    getBugReports(),
    getReleases(),
  ]);

  const metrics: AgentMetrics[] =
    metricsResult.status === "fulfilled" ? metricsResult.value : [];
  const tasks = tasksResult.status === "fulfilled" && tasksResult.value.success
    ? (tasksResult.value.data as Array<Record<string, unknown>>)
    : [];
  const bugs = bugsResult.status === "fulfilled" && bugsResult.value.success
    ? (bugsResult.value.data as Array<Record<string, unknown>>)
    : [];
  const releases = releasesResult.status === "fulfilled" && releasesResult.value.success
    ? (releasesResult.value.data as Array<Record<string, unknown>>)
    : [];

  return { metrics, tasks, bugs, releases };
}

// ─── HTML Generation ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(3)}¢`;
  return `$${usd.toFixed(4)}`;
}

function agentColor(name: string): string {
  if (name === "PM/PO") return "#3b82f6";
  if (name === "SE") return "#22c55e";
  if (name === "QA") return "#a855f7";
  return "#6b7280";
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    completed: "#22c55e",
    failed: "#ef4444",
    started: "#f59e0b",
    Backlog: "#6b7280",
    "In Progress": "#3b82f6",
    "In Review": "#f59e0b",
    QA: "#a855f7",
    Done: "#22c55e",
    Blocked: "#ef4444",
    Open: "#ef4444",
    Fixed: "#22c55e",
    Planning: "#6b7280",
    Released: "#22c55e",
    Cancelled: "#ef4444",
  };
  const color = colors[status] ?? "#6b7280";
  return `<span style="background:${color}20;color:${color};border:1px solid ${color}40;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600">${status}</span>`;
}

function buildHtml(data: Awaited<ReturnType<typeof fetchDashboardData>>, updatedAt: string): string {
  const { metrics, tasks, bugs, releases } = data;

  // Aggregate stats
  const totalRuns = metrics.length;
  const totalTokens = metrics.reduce((s, m) => s + m.totalTokens, 0);
  const totalCost = metrics.reduce((s, m) => s + m.costUsd, 0);
  const avgDuration = totalRuns > 0
    ? metrics.reduce((s, m) => s + m.durationMs, 0) / totalRuns
    : 0;

  const taskDone = tasks.filter((t) => t.status === "Done").length;
  const taskInProgress = tasks.filter((t) => t.status === "In Progress").length;
  const taskBacklog = tasks.filter((t) => t.status === "Backlog").length;
  const taskInReview = tasks.filter((t) => t.status === "In Review").length;
  const openBugs = bugs.filter((b) => b.status === "Open").length;

  // Per-agent breakdown
  const agents = ["PM/PO", "SE", "QA"] as const;
  const agentStats = agents.map((name) => {
    const runs = metrics.filter((m) => m.agentName === name);
    return {
      name,
      runs: runs.length,
      tokens: runs.reduce((s, m) => s + m.totalTokens, 0),
      cost: runs.reduce((s, m) => s + m.costUsd, 0),
      lastStatus: runs[0]?.status ?? "—",
    };
  });

  // Release progress bar
  const totalTasks = tasks.length;
  const donePercent = totalTasks > 0 ? Math.round((taskDone / totalTasks) * 100) : 0;

  const metricsRows = metrics
    .slice(0, 20)
    .map(
      (m) => `
      <tr>
        <td><span style="color:${agentColor(m.agentName)};font-weight:600">${m.agentName}</span></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.taskTitle}">${m.taskTitle || "—"}</td>
        <td>${statusBadge(m.status)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${m.totalTokens.toLocaleString()}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${formatCost(m.costUsd)}</td>
        <td style="text-align:right">${formatDuration(m.durationMs)}</td>
        <td style="color:#6b7280;font-size:11px">${new Date(m.timestamp).toLocaleString()}</td>
      </tr>`
    )
    .join("");

  const taskRows = tasks
    .slice(0, 15)
    .map(
      (t) => `
      <tr>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title as string}</td>
        <td>${statusBadge(t.status as string)}</td>
        <td><span style="font-size:11px;color:#9ca3af">${t.assignee as string || "—"}</span></td>
        <td><span style="font-size:11px;color:#6b7280">${t.priority as string}</span></td>
      </tr>`
    )
    .join("");

  const releaseRows = releases
    .map(
      (r) => `
      <tr>
        <td style="font-weight:600">${r.name as string}</td>
        <td>${statusBadge(r.status as string)}</td>
        <td style="font-size:11px;color:#9ca3af">${r.version as string || "—"}</td>
        <td style="text-align:right">${r.bugCount as number ?? 0}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="15">
  <title>AI Dev Team — Live Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --border: #2a2d3a;
      --text: #e2e8f0;
      --muted: #6b7280;
      --accent: #6366f1;
    }
    body { background: var(--bg); color: var(--text); font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size: 14px; min-height: 100vh; }
    header { background: linear-gradient(135deg, #1e1b4b 0%, #1a1d27 100%); border-bottom: 1px solid var(--border); padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
    .logo { display: flex; align-items: center; gap: 12px; }
    .logo-icon { width: 36px; height: 36px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .logo-text h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
    .logo-text p { font-size: 12px; color: var(--muted); margin-top: 1px; }
    .header-right { text-align: right; }
    .live-dot { display: inline-block; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .updated { font-size: 11px; color: var(--muted); margin-top: 3px; }
    main { padding: 24px 32px; max-width: 1400px; margin: 0 auto; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    .card-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 10px; }
    .stat-value { font-size: 32px; font-weight: 700; letter-spacing: -1px; line-height: 1; }
    .stat-sub { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .section-header { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .section-header::after { content:''; flex: 1; height: 1px; background: var(--border); }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; }
    td { padding: 10px 12px; border-bottom: 1px solid #1e2130; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .agent-badge { display: inline-flex; align-items: center; gap: 6px; }
    .progress-bar { background: var(--border); border-radius: 4px; height: 8px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #6366f1, #a855f7); transition: width 0.3s; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-12 { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; }
    .empty { color: var(--muted); font-style: italic; padding: 20px; text-align: center; }
    .agent-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .agent-row:last-child { border-bottom: none; }
    .agent-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .agent-info { flex: 1; }
    .agent-name { font-weight: 600; font-size: 13px; }
    .agent-stats { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .agent-metric { text-align: right; }
    .agent-metric .val { font-size: 15px; font-weight: 600; }
    .agent-metric .lbl { font-size: 10px; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <div class="logo-icon">🤖</div>
      <div class="logo-text">
        <h1>AI Dev Team</h1>
        <p>PM/PO · Software Engineer · QA — Powered by Claude</p>
      </div>
    </div>
    <div class="header-right">
      <div><span class="live-dot"></span><span style="font-size:12px;color:#22c55e;font-weight:600">LIVE</span> &nbsp;<span style="font-size:12px;color:var(--muted)">Auto-refresh every 15s</span></div>
      <div class="updated">Last updated: ${updatedAt}</div>
    </div>
  </header>

  <main>
    <!-- KPI cards -->
    <div class="grid-4">
      <div class="card">
        <div class="card-title">Total Agent Runs</div>
        <div class="stat-value">${totalRuns}</div>
        <div class="stat-sub">PM/PO + SE + QA combined</div>
      </div>
      <div class="card">
        <div class="card-title">Total Tokens Used</div>
        <div class="stat-value">${totalTokens > 0 ? (totalTokens / 1000).toFixed(1) + "K" : "0"}</div>
        <div class="stat-sub">input + output + thinking</div>
      </div>
      <div class="card">
        <div class="card-title">Total Cost</div>
        <div class="stat-value">${formatCost(totalCost)}</div>
        <div class="stat-sub">Opus 4.6 pricing</div>
      </div>
      <div class="card">
        <div class="card-title">Avg Run Duration</div>
        <div class="stat-value">${formatDuration(avgDuration)}</div>
        <div class="stat-sub">across all agents</div>
      </div>
    </div>

    <!-- Release progress + Agent breakdown -->
    <div class="grid-2" style="margin-bottom:24px">
      <div class="card">
        <div class="card-title">Release Progress</div>
        ${releases.length > 0
          ? releases.map((r) => `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="font-weight:600">${r.name as string}</span>${statusBadge(r.status as string)}</div></div>`).join("")
          : ""}
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:4px">
            <span>Tasks complete</span>
            <span>${taskDone} / ${totalTasks} (${donePercent}%)</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${donePercent}%"></div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:16px">
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#22c55e">${taskDone}</div>
            <div style="font-size:10px;color:var(--muted)">Done</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#3b82f6">${taskInProgress}</div>
            <div style="font-size:10px;color:var(--muted)">In Progress</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#f59e0b">${taskInReview}</div>
            <div style="font-size:10px;color:var(--muted)">In Review</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#6b7280">${taskBacklog}</div>
            <div style="font-size:10px;color:var(--muted)">Backlog</div>
          </div>
        </div>
        ${openBugs > 0 ? `<div style="margin-top:12px;padding:8px 12px;background:#ef444420;border:1px solid #ef444440;border-radius:8px;font-size:12px;color:#ef4444">⚠️ ${openBugs} open bug${openBugs !== 1 ? "s" : ""}</div>` : `<div style="margin-top:12px;padding:8px 12px;background:#22c55e20;border:1px solid #22c55e40;border-radius:8px;font-size:12px;color:#22c55e">✅ No open bugs</div>`}
      </div>

      <div class="card">
        <div class="card-title">Agents</div>
        ${agentStats.map((a) => `
          <div class="agent-row">
            <div class="agent-dot" style="background:${agentColor(a.name)}"></div>
            <div class="agent-info">
              <div class="agent-name" style="color:${agentColor(a.name)}">${a.name}</div>
              <div class="agent-stats">${a.runs} run${a.runs !== 1 ? "s" : ""} · ${(a.tokens / 1000).toFixed(1)}K tokens</div>
            </div>
            <div class="agent-metric">
              <div class="val">${formatCost(a.cost)}</div>
              <div class="lbl">cost</div>
            </div>
          </div>`).join("")}
      </div>
    </div>

    <!-- Metrics table + Tasks -->
    <div class="grid-12">
      <div class="card">
        <div class="section-header">Recent Agent Runs</div>
        ${metrics.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Task</th>
              <th>Status</th>
              <th style="text-align:right">Tokens</th>
              <th style="text-align:right">Cost</th>
              <th style="text-align:right">Duration</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>${metricsRows}</tbody>
        </table>` : `<div class="empty">No agent runs recorded yet.<br>Run an agent to see metrics here.</div>`}
      </div>

      <div class="card">
        <div class="section-header">Backlog</div>
        ${tasks.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>${taskRows}</tbody>
        </table>` : `<div class="empty">No tasks found.</div>`}

        ${releases.length > 0 ? `
        <div style="margin-top:20px">
          <div class="section-header">Releases</div>
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Version</th><th style="text-align:right">Bugs</th></tr></thead>
            <tbody>${releaseRows}</tbody>
          </table>
        </div>` : ""}
      </div>
    </div>
  </main>
</body>
</html>`;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.url === "/api/data") {
    try {
      const data = await fetchDashboardData();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Serve dashboard HTML
  try {
    const data = await fetchDashboardData();
    const html = buildHtml(data, new Date().toLocaleString());
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Dashboard error: " + String(err));
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 AI Dev Team Dashboard running at http://localhost:${PORT}\n`);
  console.log("   Auto-refreshes every 15 seconds.");
  console.log("   Press Ctrl+C to stop.\n");
});
