/**
 * SE Agent stub -- src/agents/se.ts
 *
 * Placeholder until the full Software Engineer agent is implemented.
 */

export interface SeRunInput {
  taskId?: string;
  release?: string;
}

export interface SeRunResult {
  success: boolean;
  prUrl?: string;
  error?: string;
}

export async function run(_input: SeRunInput): Promise<SeRunResult> {
  console.log('[SE Agent] Not yet implemented — skipping SE phase.');
  return { success: true };
}
