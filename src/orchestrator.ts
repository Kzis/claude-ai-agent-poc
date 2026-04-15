/**
 * Orchestrator -- src/orchestrator.ts
 *
 * Top-level script that coordinates the three-agent pipeline:
 *   Phase 1: PM/PO  -- plan and prioritise the sprint
 *   Phase 2: SE     -- implement the highest-priority task
 *   Phase 3: QA     -- test the implemented task
 *
 * Human-in-the-loop prompts gate each phase transition so the operator
 * can inspect results before proceeding.
 *
 * Usage:
 *   npm run orchestrate
 */

import * as readline from "readline";
import { run as pmRun } from "./agents/pm";
import { run as seRun } from "./agents/se";
import { run as qaRun } from "./agents/qa";

// ─── ANSI colour helpers ──────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

function header(phase: string, colour: string): void {
  const bar = "═".repeat(60);
  console.log("");
  console.log(colour + BOLD + bar + RESET);
  console.log(colour + BOLD + "  " + phase + RESET);
  console.log(colour + BOLD + bar + RESET);
  console.log("");
}

// ─── Interactive prompt ───────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function confirmProceed(phaseName: string): Promise<boolean> {
  const answer = await prompt(
    YELLOW + BOLD + "Proceed to " + phaseName + " phase? (yes/no): " + RESET
  );
  return answer === "yes" || answer === "y";
}

// ─── Main orchestration loop ──────────────────────────────────────────────────

export async function main(): Promise<void> {
  header("MULTI-AGENT ORCHESTRATOR — Release-1", CYAN);
  console.log("This orchestrator runs three agents in sequence:");
  console.log("  1. PM/PO  — plan and prioritise the sprint");
  console.log("  2. SE     — implement the highest-priority task");
  console.log("  3. QA     — test and validate the implementation");
  console.log("");

  // ── Collect the product idea ───────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const idea: string = await new Promise((resolve) => {
    rl.question(
      CYAN + "Enter the product idea for this sprint (or press Enter to skip PM phase): " + RESET,
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });

  let seTaskId: string | undefined;
  let sePrUrl: string | undefined;

  // ── Phase 1: PM/PO ─────────────────────────────────────────────────────────
  header("Phase 1 — PM/PO Agent", MAGENTA);

  if (!idea) {
    console.log("[Orchestrator] No product idea provided — skipping PM phase.");
  } else {
    try {
      const pmResult = await pmRun({
        idea,
        release: "Release-1",
        maxTasks: 6,
      });

      if (pmResult.success) {
        console.log(
          GREEN +
            "[Orchestrator] PM phase complete. Tasks created: " +
            String(pmResult.tasksCreated.length) +
            RESET
        );
        // Pick the highest-priority task created this sprint as the SE target
        const highestPriority = pmResult.tasksCreated[0];
        if (highestPriority) {
          seTaskId = highestPriority.id;
          console.log(
            "[Orchestrator] Target task for SE: " + highestPriority.title
          );
        }
      } else {
        console.error(RED + "[Orchestrator] PM phase failed: " + (pmResult.error ?? "unknown error") + RESET);
      }
    } catch (err) {
      console.error(RED + "[Orchestrator] PM phase threw an error: " + String(err) + RESET);
    }
  }

  // ── Phase 1 → 2 gate ──────────────────────────────────────────────────────
  const proceedToSe = await confirmProceed("SE");
  if (!proceedToSe) {
    console.log("[Orchestrator] Halted before SE phase. Exiting.");
    return;
  }

  // ── Phase 2: SE ────────────────────────────────────────────────────────────
  header("Phase 2 — Software Engineer Agent", GREEN);

  try {
    const seResult = await seRun({
      taskId: seTaskId,
      release: "Release-1",
    });

    if (seResult.success) {
      sePrUrl = seResult.prUrl;
      console.log(
        GREEN + "[Orchestrator] SE phase complete." + (sePrUrl ? " PR: " + sePrUrl : "") + RESET
      );
    } else {
      console.error(RED + "[Orchestrator] SE phase failed: " + (seResult.error ?? "unknown error") + RESET);
    }
  } catch (err) {
    console.error(RED + "[Orchestrator] SE phase threw an error: " + String(err) + RESET);
  }

  // ── Phase 2 → 3 gate ──────────────────────────────────────────────────────
  const proceedToQa = await confirmProceed("QA");
  if (!proceedToQa) {
    console.log("[Orchestrator] Halted before QA phase. Exiting.");
    return;
  }

  // ── Phase 3: QA ────────────────────────────────────────────────────────────
  header("Phase 3 — QA Agent", YELLOW);

  try {
    const qaResult = await qaRun({
<<<<<<< Updated upstream
      taskId: seTaskId,
      prUrl: sePrUrl,
=======
>>>>>>> Stashed changes
      release: "Release-1",
    });

    if (qaResult.success) {
<<<<<<< Updated upstream
      const rec = qaResult.recommendation ?? "(no recommendation)";
      const bugsFound = String(qaResult.bugsFound ?? 0);
=======
      const rec = (qaResult.report && qaResult.report.recommendation) ?? "(no recommendation)";
      const bugsFound = String((qaResult.report && qaResult.report.bugsFiledCount) ?? 0);
>>>>>>> Stashed changes
      console.log(
        GREEN +
          "[Orchestrator] QA phase complete. Bugs found: " +
          bugsFound +
          ". Recommendation: " +
          rec +
          RESET
      );

<<<<<<< Updated upstream
      if (qaResult.recommendation === "go") {
=======
      if (qaResult.report && qaResult.report.recommendation === "GO") {
>>>>>>> Stashed changes
        header("PIPELINE COMPLETE — GO for release", GREEN);
      } else {
        header("PIPELINE COMPLETE — NO-GO: bugs need fixing", RED);
      }
    } else {
      console.error(RED + "[Orchestrator] QA phase failed: " + (qaResult.error ?? "unknown error") + RESET);
    }
  } catch (err) {
    console.error(RED + "[Orchestrator] QA phase threw an error: " + String(err) + RESET);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(RED + "[Orchestrator] Fatal error: " + String(err) + RESET);
    process.exit(1);
  });
}
