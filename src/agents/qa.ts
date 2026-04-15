/**
 * QA Agent -- src/agents/qa.ts
 *
 * Uses Claude claude-opus-4-6 with extended thinking to:
 *   1. Fetch tasks that are "In Review" from the Notion backlog.
 *   2. Run acceptance tests (TypeScript type-check + file/content checks).
 *   3. File structured bug reports for any failures.
 *   4. Approve (Done) or reject (In Progress) each task.
 *   5. Generate a QA release report with a GO / NO-GO recommendation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { getTasks, updateTask, createBugReport } from "../tools/notion";
import type { Task, BugReport, BugSeverity, ToolResult } from "../tools/types";

// I/O types

export interface QaRunInput {
  release?: string;
  maxIterations?: number;
<<<<<<< Updated upstream
=======
  taskId?: string;
  prUrl?: string;
>>>>>>> Stashed changes
}

export interface QaReport {
  tasksTested: number;
  passed: number;
  failed: number;
  bugsFiledCount: number;
  bugsFiled: BugReport[];
  approvedTasks: Task[];
  rejectedTasks: Task[];
  recommendation: "GO" | "NO-GO";
  summary: string;
}

export interface QaRunResult {
  success: boolean;
  report: QaReport;
<<<<<<< Updated upstream
=======
  recommendation?: string;
  bugsFound?: number;
>>>>>>> Stashed changes
  error?: string;
}

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const tools: Anthropic.Tool[] = [
  {
    name: "get_in_review_tasks",
    description:
      "Fetch all tasks currently in In Review status from the Notion backlog. " +
      "Optionally filter by release label. Returns a list of Task objects.",
    input_schema: {
      type: "object" as const,
      properties: {
        release: {
          type: "string",
          description: "Optional release label to filter by (e.g. Release-1).",
        },
      },
      required: [],
    },
  },
  {
    name: "run_tests",
    description:
      "Run automated acceptance tests against the current codebase. " +
      "Executes npx tsc --noEmit for type-checking and file sanity checks. " +
      "Returns { passed: boolean, details: string }.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The Notion task ID being tested." },
        checkPaths: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of file paths to verify exist (relative to project root).",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "file_bug_report",
    description:
      "Create a structured bug report in the Notion Bug Reports database. " +
      "Call this when a test fails or an acceptance criterion is not met.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short, descriptive bug title." },
        description: { type: "string", description: "Full description of the defect." },
        stepsToReproduce: { type: "string", description: "Steps to reproduce the bug." },
        severity: {
          type: "string",
          enum: ["Critical", "High", "Medium", "Low"],
          description: "Severity of the bug.",
        },
        relatedTaskId: { type: "string", description: "Notion task ID this bug is associated with." },
        release: { type: "string", description: "Target release label." },
      },
      required: ["title", "description", "stepsToReproduce", "severity", "relatedTaskId", "release"],
    },
  },
  {
    name: "approve_task",
    description: "Mark a task as Done in Notion. Call this when all acceptance tests pass.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The Notion page ID of the task to approve." },
        notes: { type: "string", description: "Optional QA notes to append to the Work Log." },
      },
      required: ["taskId"],
    },
  },
  {
    name: "reject_task",
    description:
      "Send a task back to In Progress in Notion because it failed QA. " +
      "Always file a bug report BEFORE calling this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The Notion page ID of the task to reject." },
        reason: { type: "string", description: "Brief reason for rejection." },
      },
      required: ["taskId", "reason"],
    },
  },
  {
    name: "generate_qa_report",
    description:
      "Compile and return the final QA release report. " +
      "Call this ONCE after processing all tasks.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Narrative summary of the QA run." },
        recommendation: {
          type: "string",
          enum: ["GO", "NO-GO"],
          description: "GO if all tasks passed and no Critical/High bugs. NO-GO otherwise.",
        },
      },
      required: ["summary", "recommendation"],
    },
  },
];

// Tool input types

interface GetInReviewTasksInput { release?: string; }
interface RunTestsInput { taskId: string; checkPaths?: string[]; }
interface FileBugReportInput {
  title: string;
  description: string;
  stepsToReproduce: string;
  severity: BugSeverity;
  relatedTaskId: string;
  release: string;
}
interface ApproveTaskInput { taskId: string; notes?: string; }
interface RejectTaskInput { taskId: string; reason: string; }
interface GenerateQaReportInput { summary: string; recommendation: "GO" | "NO-GO"; }

// Agent state

interface AgentState {
  inReviewTasks: Task[];
  approvedTasks: Task[];
  rejectedTasks: Task[];
  bugsFiled: BugReport[];
  reportGenerated: boolean;
  finalReport: QaReport | null;
}

// Tool executor

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  state: AgentState,
  releaseFilter?: string
): Promise<ToolResult> {
  switch (toolName) {
    case "get_in_review_tasks": {
      const args = input as GetInReviewTasksInput;
      const release = args.release ?? releaseFilter;
      const result = await getTasks({ status: "In Review", ...(release ? { release } : {}) });
      if (result.success && Array.isArray(result.data)) {
        state.inReviewTasks = result.data as Task[];
        console.log("[QA Agent] Found " + String(state.inReviewTasks.length) + " task(s) in In Review.");
      }
      return result;
    }

    case "run_tests": {
<<<<<<< Updated upstream
      const args = input as RunTestsInput;
=======
      const args = input as unknown as RunTestsInput;
>>>>>>> Stashed changes
      const projectRoot = path.resolve(__dirname, "../../");
      const details: string[] = [];
      let passed = true;
      try {
        execSync("npx tsc --noEmit", { cwd: projectRoot, stdio: "pipe" });
        details.push("tsc --noEmit: PASS");
      } catch (err) {
        const stderr = (err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr?.toString().trim();
        details.push("tsc --noEmit: FAIL - " + (stderr ?? String(err)));
        passed = false;
      }
      if (Array.isArray(args.checkPaths)) {
        for (const relPath of args.checkPaths) {
          const abs = path.resolve(projectRoot, relPath);
          details.push("File [" + relPath + "]: " + (fs.existsSync(abs) ? "EXISTS" : "MISSING"));
          if (!fs.existsSync(abs)) passed = false;
        }
      }
      for (const agent of ["pm.ts", "qa.ts"]) {
        const ap = path.join(projectRoot, "src", "agents", agent);
        details.push("Agent [" + agent + "]: " + (fs.existsSync(ap) ? "EXISTS" : "MISSING"));
        if (!fs.existsSync(ap)) passed = false;
      }
      console.log("[QA Agent] run_tests " + args.taskId + ": " + (passed ? "PASS" : "FAIL"));
      return { success: true, data: { passed, details: details.join("; ") } };
    }

    case "file_bug_report": {
<<<<<<< Updated upstream
      const args = input as FileBugReportInput;
=======
      const args = input as unknown as FileBugReportInput;
>>>>>>> Stashed changes
      console.log("[QA Agent] Filing bug: " + args.title + " (" + args.severity + ")");
      const result = await createBugReport({
        title: args.title,
        description: args.description,
        stepsToReproduce: args.stepsToReproduce,
        severity: args.severity,
        relatedTaskId: args.relatedTaskId,
        release: args.release,
      });
      if (result.success && result.data) state.bugsFiled.push(result.data as BugReport);
      return result;
    }

    case "approve_task": {
<<<<<<< Updated upstream
      const args = input as ApproveTaskInput;
=======
      const args = input as unknown as ApproveTaskInput;
>>>>>>> Stashed changes
      console.log("[QA Agent] Approving task " + args.taskId);
      const workLog = args.notes ? "QA APPROVED: " + args.notes : "QA APPROVED: All acceptance tests passed.";
      const result = await updateTask(args.taskId, { status: "Done", workLog });
      if (result.success) {
        const task = state.inReviewTasks.find((t) => t.id === args.taskId);
        if (task) state.approvedTasks.push({ ...task, status: "Done" });
      }
      return result;
    }

    case "reject_task": {
<<<<<<< Updated upstream
      const args = input as RejectTaskInput;
=======
      const args = input as unknown as RejectTaskInput;
>>>>>>> Stashed changes
      console.log("[QA Agent] Rejecting task " + args.taskId + ": " + args.reason);
      const result = await updateTask(args.taskId, { status: "In Progress", workLog: "QA REJECTED: " + args.reason });
      if (result.success) {
        const task = state.inReviewTasks.find((t) => t.id === args.taskId);
        if (task) state.rejectedTasks.push({ ...task, status: "In Progress" });
      }
      return result;
    }

    case "generate_qa_report": {
<<<<<<< Updated upstream
      const args = input as GenerateQaReportInput;
=======
      const args = input as unknown as GenerateQaReportInput;
>>>>>>> Stashed changes
      const passedCount = state.approvedTasks.length;
      const failedCount = state.rejectedTasks.length;
      const qaReport: QaReport = {
        tasksTested: passedCount + failedCount,
        passed: passedCount,
        failed: failedCount,
        bugsFiledCount: state.bugsFiled.length,
        bugsFiled: state.bugsFiled,
        approvedTasks: state.approvedTasks,
        rejectedTasks: state.rejectedTasks,
        recommendation: args.recommendation,
        summary: args.summary,
      };
      state.finalReport = qaReport;
      state.reportGenerated = true;
      console.log("[QA Agent] Report: " + String(qaReport.tasksTested) + " tested, " + String(passedCount) + " passed, " + String(failedCount) + " failed. Recommendation: " + args.recommendation);
      return { success: true, data: qaReport };
    }

    default:
      return { success: false, error: "Unknown tool: " + toolName };
  }
}

// Public entry point

export async function run(input: QaRunInput): Promise<QaRunResult> {
  const { release, maxIterations = 40 } = input;
  console.log("[QA Agent] Starting" + (release ? " for release " + release : "") + ".");

  const state: AgentState = {
    inReviewTasks: [],
    approvedTasks: [],
    rejectedTasks: [],
    bugsFiled: [],
    reportGenerated: false,
    finalReport: null,
  };

  const systemPrompt = [
    "You are a senior QA engineer on an agile software team.",
    "Your job: review In Review tasks, run tests, file bugs, approve/reject tasks,",
    "and generate a QA release report with GO / NO-GO recommendation.",
    "",
    "Rules:",
    "- Call get_in_review_tasks FIRST.",
    "- For each task call run_tests.",
    "- If passed=false: call file_bug_report then reject_task.",
    "- If passed=true: call approve_task.",
    "- After all tasks: call generate_qa_report once.",
    "- NO-GO if any Critical/High bug was filed or any task rejected.",
    "- GO only if all tasks passed and no Critical/High bugs.",
<<<<<<< Updated upstream
  ].join("
");
=======
  ].join("\n");
>>>>>>> Stashed changes

  const userMessage = [
    "Please perform a full QA review now.",
    release ? "Release filter: " + release : "Review all tasks currently In Review.",
    "",
    "1. Call get_in_review_tasks.",
    "2. For each task call run_tests.",
    "3. If fail: file_bug_report then reject_task.",
    "4. If pass: approve_task.",
    "5. After all tasks: generate_qa_report.",
<<<<<<< Updated upstream
  ].join("
");

=======
  ].join("\n");
>>>>>>> Stashed changes
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  let iteration = 0;

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
    console.log("[QA Agent] Iteration " + String(iteration) + ": stop_reason=" + response.stop_reason);

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        console.log("[QA Agent]   -> tool: " + block.name);
        const result = await executeTool(block.name, block.input as Record<string, unknown>, state, release);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (textBlock) console.log("[QA Agent] Final: " + textBlock.text);
      break;
    }
    console.warn("[QA Agent] Unexpected stop_reason: " + response.stop_reason);
    break;
  }

  if (iteration >= maxIterations) {
    console.warn("[QA Agent] Reached max iterations (" + String(maxIterations) + ").");
  }

  const report: QaReport = state.finalReport ?? {
    tasksTested: state.approvedTasks.length + state.rejectedTasks.length,
    passed: state.approvedTasks.length,
    failed: state.rejectedTasks.length,
    bugsFiledCount: state.bugsFiled.length,
    bugsFiled: state.bugsFiled,
    approvedTasks: state.approvedTasks,
    rejectedTasks: state.rejectedTasks,
    recommendation: state.rejectedTasks.length === 0 && state.bugsFiled.length === 0 ? "GO" : "NO-GO",
    summary: "QA run completed. Report was not explicitly generated by the agent.",
  };

  console.log("[QA Agent] Complete.");
  return { success: true, report };
}
