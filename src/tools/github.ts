import { Octokit } from "@octokit/rest";
import { config } from "../config";
import type { PullRequest, ToolResult } from "./types";

const octokit = new Octokit({ auth: config.github.token });

const { owner, repo, baseBranch } = config.github;

// ─── Branch ───────────────────────────────────────────────────────────────────

export async function createBranch(input: {
  branchName: string;
  fromBranch?: string;
}): Promise<ToolResult> {
  try {
    // Get the SHA of the base branch
    const base = input.fromBranch ?? baseBranch;
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${base}`,
    });

    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${input.branchName}`,
      sha: ref.object.sha,
    });

    return { success: true, data: { branch: input.branchName, sha: ref.object.sha } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Pull Request ─────────────────────────────────────────────────────────────

export async function createPullRequest(input: {
  title: string;
  body: string;
  headBranch: string;
  baseBranch?: string;
  draft?: boolean;
}): Promise<ToolResult> {
  try {
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: input.title,
      body: input.body,
      head: input.headBranch,
      base: input.baseBranch ?? baseBranch,
      draft: input.draft ?? false,
    });

    const result: PullRequest = {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      branch: pr.head.ref,
      state: "open",
    };
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function listOpenPullRequests(): Promise<ToolResult> {
  try {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 20,
    });

    const results: PullRequest[] = prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      branch: pr.head.ref,
      state: "open",
    }));
    return { success: true, data: results };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getPullRequest(prNumber: number): Promise<ToolResult> {
  try {
    const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
    const result: PullRequest = {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      branch: pr.head.ref,
      state: pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open",
    };
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Commit a file (for GitHub Pages demo deployments) ───────────────────────

export async function commitFile(input: {
  branch: string;
  path: string;
  content: string;   // base64 encoded
  message: string;
  sha?: string;      // existing file SHA (required for updates)
}): Promise<ToolResult> {
  try {
    const { data } = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: input.path,
      message: input.message,
      content: input.content,
      branch: input.branch,
      sha: input.sha,
    });
    return { success: true, data: { sha: data.content?.sha, url: data.content?.html_url } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Release ──────────────────────────────────────────────────────────────────

export async function createGitHubRelease(input: {
  tagName: string;
  name: string;
  body: string;
  draft?: boolean;
  prerelease?: boolean;
}): Promise<ToolResult> {
  try {
    const { data } = await octokit.repos.createRelease({
      owner,
      repo,
      tag_name: input.tagName,
      name: input.name,
      body: input.body,
      draft: input.draft ?? false,
      prerelease: input.prerelease ?? false,
    });
    return { success: true, data: { id: data.id, url: data.html_url } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Utility: slugify a task title into a branch name ─────────────────────────

export function toBranchName(taskTitle: string, taskId: string): string {
  const slug = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const shortId = taskId.replace(/-/g, "").slice(0, 8);
  return `feature/${shortId}-${slug}`;
}
