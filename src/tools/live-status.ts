/**
 * Live Status — pushes docs/live.json to the GitHub repo after every agent
 * iteration so the GitHub Pages dashboard stays up to date.
 *
 * Uses createOrUpdateFileContents (GitHub Contents API) — no git binary needed.
 * On SHA conflict it fetches fresh and retries once.
 */

import { Octokit } from "@octokit/rest";
import { config } from "../config";

const octokit = new Octokit({ auth: config.github.token });
const { owner, repo } = config.github;
const FILE_PATH = "docs/live.json";
const BRANCH = "main";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentName = "PM/PO" | "SE" | "QA";
export type AgentRunStatus = "idle" | "running" | "completed" | "failed";

export interface AgentLiveStatus {
  status: AgentRunStatus;
  currentAction: string;
  iteration: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  startedAt: string | null;
  completedAt: string | null;
  taskTitle: string;
  release: string;
}

export interface LiveData {
  updatedAt: string;
  agents: Record<AgentName, AgentLiveStatus>;
  history: Array<{
    agent: AgentName;
    taskTitle: string;
    status: AgentRunStatus;
    totalTokens: number;
    costUsd: number;
    durationMs: number;
    completedAt: string;
  }>;
}

const BLANK_AGENT: AgentLiveStatus = {
  status: "idle",
  currentAction: "",
  iteration: 0,
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  durationMs: 0,
  startedAt: null,
  completedAt: null,
  taskTitle: "",
  release: "",
};

// ─── SHA cache (avoids extra round-trips) ────────────────────────────────────

let _sha: string | undefined;

async function getFile(): Promise<{ data: LiveData; sha: string }> {
  const res = await octokit.repos.getContent({ owner, repo, path: FILE_PATH, ref: BRANCH });
  const file = res.data as { content: string; sha: string };
  _sha = file.sha;
  return {
    data: JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as LiveData,
    sha: file.sha,
  };
}

async function putFile(data: LiveData, sha: string | undefined, msg: string): Promise<void> {
  const b64 = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
  await octokit.repos.createOrUpdateFileContents({
    owner, repo,
    path: FILE_PATH,
    message: msg,
    content: b64,
    branch: BRANCH,
    sha,
  });
  _sha = undefined; // invalidate so next call fetches fresh SHA
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Push a status update for one agent.
 * Called after every agent iteration and on completion.
 * Silently swallows errors so a GitHub issue never breaks the agent.
 */
export async function updateAgentStatus(
  agentName: AgentName,
  patch: Partial<AgentLiveStatus>
): Promise<void> {
  try {
    let current: LiveData;
    let sha: string | undefined = _sha;

    try {
      ({ data: current, sha } = await getFile());
    } catch {
      current = {
        updatedAt: new Date().toISOString(),
        agents: {
          "PM/PO": { ...BLANK_AGENT },
          "SE": { ...BLANK_AGENT },
          "QA": { ...BLANK_AGENT },
        },
        history: [],
      };
      sha = undefined;
    }

    current.agents[agentName] = { ...current.agents[agentName], ...patch };
    current.updatedAt = new Date().toISOString();

    // On completion, append to history
    if ((patch.status === "completed" || patch.status === "failed") && patch.completedAt) {
      const entry = {
        agent: agentName,
        taskTitle: current.agents[agentName].taskTitle,
        status: patch.status,
        totalTokens: current.agents[agentName].totalTokens,
        costUsd: current.agents[agentName].costUsd,
        durationMs: current.agents[agentName].durationMs,
        completedAt: patch.completedAt,
      };
      current.history = [entry, ...(current.history ?? [])].slice(0, 20);
    }

    const msg = `live: [${agentName}] ${patch.currentAction ?? patch.status ?? "update"}`;
    try {
      await putFile(current, sha, msg);
    } catch (err) {
      // SHA conflict — fetch fresh and retry once
      if (/409|422|conflict/i.test(String(err))) {
        const fresh = await getFile();
        fresh.data.agents[agentName] = { ...fresh.data.agents[agentName], ...patch };
        fresh.data.updatedAt = new Date().toISOString();
        await putFile(fresh.data, fresh.sha, msg + " (retry)");
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.warn(`[live-status] update skipped: ${err}`);
  }
}

/**
 * Convenience: mark agent as started.
 */
export function makeStartPatch(release: string): Partial<AgentLiveStatus> {
  return {
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    iteration: 0,
    inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
    totalTokens: 0, costUsd: 0, durationMs: 0,
    currentAction: "Starting…",
    release,
  };
}
