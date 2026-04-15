/**
 * SE (Software Engineer) Agent -- src/agents/se.ts
 *
 * Accepts an optional Task as input. If none is provided, fetches the highest-priority
 * Backlog task from Notion.
 *
 * Pattern: same agentic tool-loop as src/agents/pm.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getTasks, updateTask } from "../tools/notion";
import { createBranch, createPullRequest } from "../tools/github";
import type { Task, ToolResult } from "../tools/types";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// --- Tool definitions ---

const tools: Anthropic.Tool[] = [
  {
    name: "get_backlog_tasks",
    description:
      "Fetch tasks from the Notion backlog, optionally filtered by status. " +
      "Use this to find the highest-priority unclaimed Backlog task.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["Backlog", "In Progress", "In Review", "QA", "Done", "Blocked"],
          description: "Filter by status. Use Backlog to find available tasks.",
        },
      },
      required: [],
    },
  },
  {
    name: "update_task_status",
    description:
      "Update a Notion task status and optionally the assignee. " +
      "Call with status=In Progress and assignee=SE Agent to claim a task.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The Notion page ID of the task." },
        status: { type: "string", enum: ["Backlog", "In Progress", "In Review", "QA", "Done", "Blocked"], description: "New status." },
        assignee: { type: "string", description: "Assignee name. Use SE Agent when claiming." },
      },
      required: ["taskId", "status"],
    },
  },
  {
    name: "create_github_branch",
    description:
      "Create a feature branch in GitHub from main. " +
      "Convention: feature/<shortId>-<slugified-title>. Call after claiming the task.",
    input_schema: {
      type: "object" as const,
      properties: {
        branchName: { type: "string", description: "Branch name, e.g. feature/abc12345-add-login-page." },
        fromBranch: { type: "string", description: "Base branch. Defaults to main." },
      },
      required: ["branchName"],
    },
  },
  {
    name: "create_draft_pr",
    description:
      "Open a draft PR on GitHub. Title uses conventional commits (feat: ...). " +
      "Body includes summary, Notion task ID, and what was implemented.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "PR title in conventional commits format." },
        body: { type: "string", description: "Markdown body with summary, task ID, and changes." },
        headBranch: { type: "string", description: "The feature branch name." },
        baseBranch: { type: "string", description: "Target branch. Defaults to main." },
      },
      required: ["title", "body", "headBranch"],
    },
  },
  {
    name: "update_task_notion",
    description:
      "Update the Notion task with PR URL, work log, and In Review status. " +
      "Call this last after the PR is opened.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The Notion page ID of the task." },
        status: { type: "string", enum: ["Backlog", "In Progress", "In Review", "QA", "Done", "Blocked"], description: "Set to In Review." },
        prUrl: { type: "string", description: "URL of the draft PR." },
        workLog: { type: "string", description: "Concise work log: what was implemented and files changed." },
      },
      required: ["taskId"],
    },
  },
];

// --- Tool input types ---

interface GetBacklogTasksInput {
  status?: string;
}

interface UpdateTaskStatusInput {
  taskId: string;
  status: Task["status"];
  assignee?: string;
}

interface CreateGithubBranchInput {
  branchName: string;
  fromBranch?: string;
}

interface CreateDraftPrInput {
  title: string;
  body: string;
  headBranch: string;
  baseBranch?: string;
}

interface UpdateTaskNotionInput {
  taskId: string;
  status?: Task["status"];
  prUrl?: string;
  workLog?: string;
}

// --- Tool executor ---

async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case "get_backlog_tasks": {
      const args = input as unknown as GetBacklogTasksInput;
      return getTasks(args.status ? { status: args.status as Task["status"] } : undefined);
    }

    case "update_task_status": {
      const args = input as unknown as UpdateTaskStatusInput;
      return updateTask(args.taskId, {
        status: args.status,
        ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
      });
    }

    case "create_github_branch": {
      const args = input as unknown as CreateGithubBranchInput;
      return createBranch({
        branchName: args.branchName,
        fromBranch: args.fromBranch,
      });
    }

    case "create_draft_pr": {
      const args = input as unknown as CreateDraftPrInput;
      return createPullRequest({
        title: args.title,
        body: args.body,
        headBranch: args.headBranch,
        baseBranch: args.baseBranch,
        draft: true,
      });
    }

    case "update_task_notion": {
      const args = input as unknown as UpdateTaskNotionInput;
      return updateTask(args.taskId, {
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.prUrl !== undefined ? { prUrl: args.prUrl } : {}),
        ...(args.workLog !== undefined ? { workLog: args.workLog } : {}),
      });
    }

    default:
      return { success: false, error: "Unknown tool: " + toolName };
  }
}

// --- Public interface ---

export interface SeRunInput {
  task?: Task;
  taskId?: string;
  release?: string;
}

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
    "Your job: claim a Backlog task, create a GitHub feature branch,",
    "open a draft PR, and update Notion with the PR URL and work log.",
    "Follow these steps:",
    "1. If no task provided, call get_backlog_tasks with status=Backlog.",
    "2. Call update_task_status: status=In Progress, assignee=SE Agent.",
    "3. Derive branch name: feature/<8-char-taskId-no-dashes>-<slug-max-40>.",
    "4. Call create_github_branch with that branch name.",
    "5. Call create_draft_pr with conventional-commits title and markdown body.",
    "6. Call update_task_notion: status=In Review, PR URL, and work log.",
    "7. Respond with a final text summary.",
<<<<<<< Updated upstream
  ].join("
");
=======
  ].join("\n");
>>>>>>> Stashed changes

  const taskContext = input.task
    ? [
        "A task has been assigned to you:",
        "",
        "Task ID: " + input.task.id,
        "Title: " + input.task.title,
        "Description: " + input.task.description,
        "Priority: " + input.task.priority,
        "Release: " + input.task.release,
        "",
        "Proceed with steps 2-7 (task already known, skip step 1).",
<<<<<<< Updated upstream
      ].join("
")
    : "No task pre-assigned. Call get_backlog_tasks with status=Backlog.";

  const userMessage = taskContext + "

Complete all steps then provide a final summary.";
=======
      ].join("\n")
    : "No task pre-assigned. Call get_backlog_tasks with status=Backlog.";

  const userMessage = taskContext + "\n\nComplete all steps then provide a final summary.";
>>>>>>> Stashed changes

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

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

    console.log("[SE Agent] Iteration " + String(iteration) + ": stop_reason=" + response.stop_reason);

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
          if (block.name === "create_github_branch") {
            resolvedBranch = (result.data as { branch: string }).branch;
          }
          if (block.name === "create_draft_pr") {
            resolvedPrUrl = (result.data as { url: string }).url;
          }
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (textBlock) {
        console.log("[SE Agent] Final summary: " + textBlock.text.slice(0, 200));
      }
      break;
    }

    console.warn("[SE Agent] Unexpected stop_reason: " + response.stop_reason);
    break;
  }
<<<<<<< Updated upstream

=======
  if (iteration >= maxIterations) {
    console.warn("[SE Agent] Reached max iterations. Stopping.");
  }

  console.log("[SE Agent] Complete. Branch: " + (resolvedBranch ?? "none") + " | PR: " + (resolvedPrUrl ?? "none"));

  return { success: true, task: resolvedTask, branchName: resolvedBranch, prUrl: resolvedPrUrl };
}
>>>>>>> Stashed changes
