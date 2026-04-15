/**
 * SE (Software Engineer) Agent -- src/agents/se.ts
 * Accepts optional Task. Fetches highest-priority Backlog task if none given.
 * Creates GitHub branch, opens draft PR, updates Notion task to In Review.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getTasks, updateTask } from "../tools/notion";
import { createBranch, createPullRequest } from "../tools/github";
import type { Task, ToolResult } from "../tools/types";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const tools: Anthropic.Tool[] = [
  {
    name: "get_backlog_tasks",
    description: "Fetch backlog tasks from Notion. Pass status=Backlog to find available.",
    input_schema: { type: "object" as const, properties: { status: { type: "string", enum: ["Backlog","In Progress","In Review","QA","Done","Blocked"] } }, required: [] },
  },
  {
    name: "update_task_status",
    description: "Update task status/assignee. Use In Progress + SE Agent to claim.",
    input_schema: { type: "object" as const, properties: { taskId: { type: "string" }, status: { type: "string", enum: ["Backlog","In Progress","In Review","QA","Done","Blocked"] }, assignee: { type: "string" } }, required: ["taskId","status"] },
  },
  {
    name: "create_github_branch",
    description: "Create feature branch in GitHub from main. Convention: feature/<8charId>-<slug>.",
    input_schema: { type: "object" as const, properties: { branchName: { type: "string" }, fromBranch: { type: "string" } }, required: ["branchName"] },
  },
  {
    name: "create_draft_pr",
    description: "Open draft PR. Title: conventional-commits. Body: markdown with task ID.",
    input_schema: { type: "object" as const, properties: { title: { type: "string" }, body: { type: "string" }, headBranch: { type: "string" }, baseBranch: { type: "string" } }, required: ["title","body","headBranch"] },
  },
  {
    name: "update_task_notion",
    description: "Update Notion task: PR URL, work log, status=In Review.",
    input_schema: { type: "object" as const, properties: { taskId: { type: "string" }, status: { type: "string", enum: ["Backlog","In Progress","In Review","QA","Done","Blocked"] }, prUrl: { type: "string" }, workLog: { type: "string" } }, required: ["taskId"] },
  },
];

interface GetBacklogTasksInput { status?: string; }
interface UpdateTaskStatusInput { taskId: string; status: Task["status"]; assignee?: string; }
interface CreateGithubBranchInput { branchName: string; fromBranch?: string; }
interface CreateDraftPrInput { title: string; body: string; headBranch: string; baseBranch?: string; }
interface UpdateTaskNotionInput { taskId: string; status?: Task["status"]; prUrl?: string; workLog?: string; }

async function executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
  switch (toolName) {
    case "get_backlog_tasks": {
      const args = input as unknown as GetBacklogTasksInput;
      return getTasks(args.status ? { status: args.status as Task["status"] } : undefined);
    }
    case "update_task_status": {
      const args = input as unknown as UpdateTaskStatusInput;
      return updateTask(args.taskId, { status: args.status, ...(args.assignee ? { assignee: args.assignee } : {}) });
    }
    case "create_github_branch": {
      const args = input as unknown as CreateGithubBranchInput;
      return createBranch({ branchName: args.branchName, fromBranch: args.fromBranch });
    }
    case "create_draft_pr": {
      const args = input as unknown as CreateDraftPrInput;
      return createPullRequest({ title: args.title, body: args.body, headBranch: args.headBranch, baseBranch: args.baseBranch, draft: true });
    }
    case "update_task_notion": {
      const args = input as unknown as UpdateTaskNotionInput;
      return updateTask(args.taskId, {
        ...(args.status ? { status: args.status } : {}),
        ...(args.prUrl ? { prUrl: args.prUrl } : {}),
        ...(args.workLog ? { workLog: args.workLog } : {}),
      });
    }
    default: return { success: false, error: "Unknown tool: " + toolName };
  }
}

export interface SeRunInput { task?: Task; taskId?: string; release?: string; }

export interface SeRunResult {
  success: boolean;
  task?: Task;
  branchName?: string;
  prUrl?: string;
  error?: string;
}

export async function run(input: SeRunInput = {}): Promise<SeRunResult> {
  console.log("[SE Agent] Starting.");

  const systemPrompt = [
    "You are a staff software engineer on an agile team.",
    "Claim a Backlog task, create a feature branch, open a draft PR, update Notion.",
    "Steps:",
    "1. If no task, call get_backlog_tasks with status=Backlog.",
    "2. update_task_status: status=In Progress, assignee=SE Agent.",
    "3. Branch: feature/<8-char-taskId-no-dashes>-<slug-max-40>.",
    "4. create_github_branch.",
    "5. create_draft_pr: conventional-commits title, markdown body with task ID.",
    "6. update_task_notion: In Review, PR URL, work log.",
    "7. Final text summary.",
  ].join("\n");

  const taskCtx = input.task
    ? [
        "A task has been assigned to you:",
        "",
        "Task ID: " + input.task.id,
        "Title: " + input.task.title,
        "Description: " + input.task.description,
        "Priority: " + input.task.priority,
        "Release: " + input.task.release,
        "",
        "Proceed with steps 2-7 (task known, skip step 1).",
      ].join("\n")
    : "No task assigned. Call get_backlog_tasks with status=Backlog.";

  const userMsg = taskCtx + "\n\n" + "Complete all steps then provide a final summary.";

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

  let iteration = 0;
  const maxIterations = 30;
  let resolvedTask: Task | undefined = input.task;
  let resolvedBranch: string | undefined;
  let resolvedPrUrl: string | undefined;

  while (iteration < maxIterations) {
    iteration++;

    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 16000,
      system: systemPrompt,
      thinking: { type: "enabled", budget_tokens: 8000 },
      tools,
      messages,
    });

    console.log("[SE Agent] Iter " + String(iteration) + " stop_reason=" + response.stop_reason);

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        console.log("[SE Agent]   -> tool: " + block.name);
        const result = await executeTool(block.name, block.input as Record<string, unknown>);

        if (result.success && result.data) {
          if (block.name === "get_backlog_tasks") {
            const tasks = result.data as Task[];
            if (tasks.length > 0 && resolvedTask === undefined) resolvedTask = tasks[0];
          }
          if (block.name === "create_github_branch") resolvedBranch = (result.data as { branch: string }).branch;
          if (block.name === "create_draft_pr") resolvedPrUrl = (result.data as { url: string }).url;
        }

        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (textBlock) console.log("[SE Agent] Summary: " + textBlock.text.slice(0, 200));
      break;
    }

    console.warn("[SE Agent] Unexpected stop_reason: " + response.stop_reason);
    break;
  }

  if (iteration >= maxIterations) console.warn("[SE Agent] Max iterations reached.");

  console.log("[SE Agent] Complete.");

  return { success: true, task: resolvedTask, branchName: resolvedBranch, prUrl: resolvedPrUrl };
}

