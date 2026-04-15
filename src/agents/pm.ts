/**
 * PM/PO Agent -- src/agents/pm.ts
 *
 * Accepts a product idea and uses Claude claude-opus-4-6 with extended thinking to:
 *   1. Break the idea into Notion backlog tasks.
 *   2. Assign type, priority, and description to each task.
 *   3. Enforce the one-Critical-per-sprint rule (extras downgraded to High).
 *   4. Return a summary of every task created.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { createTask, getTasks } from "../tools/notion";
import type { Task, TaskPriority, TaskType, ToolResult } from "../tools/types";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });
const tools: Anthropic.Tool[] = [
  {
    name: "create_backlog_task",
    description:
      "Create a single backlog task in the Notion project management database. " +
      "Call this once per task. Enforce the one-Critical-per-sprint rule: " +
      "only ONE task across the entire sprint may have priority=Critical.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short, imperative task title." },
        description: {
          type: "string",
          description: "Detailed description with acceptance criteria (2-5 sentences).",
        },
        type: {
          type: "string",
          enum: ["Feature", "Bug Fix", "Chore", "Research"],
          description: "Task type.",
        },
        priority: {
          type: "string",
          enum: ["Critical", "High", "Medium", "Low"],
          description: "Priority. Only ONE task per sprint may be Critical.",
        },
        release: { type: "string", description: "Target release identifier." },
      },
      required: ["title", "description", "type", "priority", "release"],
    },
  },
  {
    name: "get_existing_tasks",
    description:
      "Retrieve existing tasks from the Notion backlog (optionally filtered by status). " +
      "Use this to check how many Critical tasks already exist before adding new ones.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["Backlog", "In Progress", "In Review", "QA", "Done", "Blocked"],
          description: "Filter by status. Omit to retrieve all tasks.",
        },
      },
      required: [],
    },
  },
];
interface CreateTaskInput {
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  release: string;
}

interface GetExistingTasksInput {
  status?: string;
}

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  criticalCount: { value: number }
): Promise<ToolResult> {
  if (toolName === "create_backlog_task") {
    const args = input as unknown as CreateTaskInput;
    let priority = args.priority;
    if (priority === "Critical") {
      if (criticalCount.value >= 1) {
        console.warn(
          "[PM Agent] Downgrading task from Critical to High" +
            " (one-Critical-per-sprint rule already satisfied): " +
            args.title
        );
        priority = "High";
      } else {
        criticalCount.value += 1;
      }
    }
    return createTask({
      title: args.title,
      description: args.description,
      type: args.type,
      priority,
      release: args.release,
    });
  }
  if (toolName === "get_existing_tasks") {
    const args = input as GetExistingTasksInput;
    return getTasks(args.status ? { status: args.status as Task["status"] } : undefined);
  }
  return { success: false, error: "Unknown tool: " + toolName };
}
export interface PmRunInput {
  idea: string;
  release: string;
  maxTasks?: number;
}

export interface PmRunResult {
  success: boolean;
  tasksCreated: Task[];
  criticalTaskCount: number;
  error?: string;
}
export async function run(input: PmRunInput): Promise<PmRunResult> {
  const { idea, release, maxTasks = 8 } = input;
  const tasksCreated: Task[] = [];
  const criticalCount = { value: 0 };

  console.log("[PM Agent] Starting for release " + release);

  const systemPrompt =
    "You are a senior PM/PO on an agile software team. " +
    "Break product ideas into well-scoped backlog tasks and enforce sprint discipline. " +
    "RULE: Only ONE task per sprint may have priority=Critical. " +
    "All other tasks must be High, Medium, or Low.";

  const userMessage = [
    "A stakeholder has shared the following product idea:",
    "",
    idea,
    "",
    "Target release: " + release,
    "Maximum tasks to create: " + String(maxTasks),
    "",
    "Your job:",
    "1. Call get_existing_tasks (no filter) to review what is already in the backlog.",
    "2. Break the product idea into " + String(maxTasks) + " or fewer well-scoped backlog tasks.",
    "3. For each task, call create_backlog_task with type, priority, and description.",
    "4. CRITICAL RULE: Only ONE task may have priority=Critical. All others must be High, Medium, or Low.",
    "5. After creating all tasks, respond with a text summary listing every task title and priority.",
  ].join("\n");

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];
  let iteration = 0;
  const maxIterations = 30;

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

    console.log(
      "[PM Agent] Iteration " + String(iteration) + ": stop_reason=" + response.stop_reason
    );

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        console.log("[PM Agent]   -> tool: " + block.name);
        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
          criticalCount
        );
        if (block.name === "create_backlog_task" && result.success && result.data) {
          tasksCreated.push(result.data as Task);
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
        console.log("[PM Agent] Final summary:\n" + textBlock.text);
      }
      break;
    }

    console.warn("[PM Agent] Unexpected stop_reason: " + response.stop_reason + ". Stopping.");
    break;
  }

  if (iteration >= maxIterations) {
    console.warn("[PM Agent] Reached max iterations (" + String(maxIterations) + "). Stopping.");
  }

  console.log(
    "[PM Agent] Complete. Created " + String(tasksCreated.length) + " task(s), " +
      String(criticalCount.value) + " Critical."
  );

  return {
    success: true,
    tasksCreated,
    criticalTaskCount: criticalCount.value,
  };
}
