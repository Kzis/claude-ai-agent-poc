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
import { calculateCost } from "../tools/types";
import { updateAgentStatus, makeStartPatch } from "../tools/live-status";

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

  // Metrics tracking
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalThinkingTokens = 0;

  void updateAgentStatus("SE", {
    ...makeStartPatch(input.release ?? "Release-2"),
    taskTitle: input.task?.title ?? "Fetching task…",
  });

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

    // Track token usage per iteration
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;
    for (const block of response.content) {
      if (block.type === "thinking") totalThinkingTokens += block.thinking?.length ?? 0;
    }

    console.log("[SE Agent] Iter " + String(iteration) + " stop_reason=" + response.stop_reason);

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let lastAction = "";
      for (const block of toolUseBlocks) {
        console.log("[SE Agent]   -> tool: " + block.name);
        const result = await executeTool(block.name, block.input as Record<string, unknown>);

        if (result.success && result.data) {
          if (block.name === "get_backlog_tasks") {
            const tasks = result.data as Task[];
            if (tasks.length > 0 && resolvedTask === undefined) resolvedTask = tasks[0];
            lastAction = "Reading backlog tasks…";
          }
          if (block.name === "create_github_branch") {
            resolvedBranch = (result.data as { branch: string }).branch;
            lastAction = "Creating branch: " + resolvedBranch;
          }
          if (block.name === "create_draft_pr") {
            resolvedPrUrl = (result.data as { url: string }).url;
            lastAction = "Opened draft PR";
          }
          if (block.name === "update_task_status") lastAction = "Updating task status…";
          if (block.name === "log_work") lastAction = "Logging work to Notion…";
          if (block.name === "await_human_pr_approval") lastAction = "⏳ Waiting for human PR approval";
        }

        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }

      messages.push({ role: "user", content: toolResults });
      void updateAgentStatus("SE", {
        status: "running",
        currentAction: lastAction || "Thinking…",
        iteration,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens,
        totalTokens: totalInputTokens + totalOutputTokens + totalThinkingTokens,
        costUsd: calculateCost(totalInputTokens, totalOutputTokens, totalThinkingTokens),
        durationMs: Date.now() - startTime,
        taskTitle: resolvedTask?.title ?? "Fetching task…",
        release: input.release ?? "Release-2",
      });
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

  void updateAgentStatus("SE", {
    status: "completed",
    currentAction: resolvedPrUrl ? "PR opened: " + resolvedPrUrl : "Done",
    iteration,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    thinkingTokens: totalThinkingTokens,
    totalTokens: totalInputTokens + totalOutputTokens + totalThinkingTokens,
    costUsd: calculateCost(totalInputTokens, totalOutputTokens, totalThinkingTokens),
    durationMs: Date.now() - startTime,
    completedAt: new Date().toISOString(),
    taskTitle: resolvedTask?.title ?? "",
    release: input.release ?? "Release-2",
  });

  // Emit metrics (metrics.ts may not exist yet -- wrapped in try/catch)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metricsModule = await import("../tools/metrics") as any;
    await metricsModule.createMetric({
      agentName: "SE",
      taskId: resolvedTask?.id ?? "unknown",
      taskTitle: resolvedTask?.title ?? "unknown",
      status: "completed",
      model: config.anthropic.model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      thinkingTokens: totalThinkingTokens,
      totalTokens: totalInputTokens + totalOutputTokens + totalThinkingTokens,
      costUsd: metricsModule.calculateCost(totalInputTokens, totalOutputTokens, totalThinkingTokens),
      durationMs: Date.now() - startTime,
      releaseId: input.release ?? "Release-2",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[SE Agent] Could not emit metrics:", e);
  }

  return { success: true, task: resolvedTask, branchName: resolvedBranch, prUrl: resolvedPrUrl };
}

