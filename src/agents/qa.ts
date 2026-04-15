/**
 * QA Agent stub -- src/agents/qa.ts
 *
 * Placeholder until the full QA agent is implemented.
 */

export interface QaRunInput {
  taskId?: string;
  prUrl?: string;
  release?: string;
}

export interface QaRunResult {
  success: boolean;
  bugsFound?: number;
  recommendation?: "go" | "no-go";
  error?: string;
}

export async function run(_input: QaRunInput): Promise<QaRunResult> {
  console.log("[QA Agent] Not yet implemented — skipping QA phase.");
  return { success: true, bugsFound: 0, recommendation: "go" };
}
