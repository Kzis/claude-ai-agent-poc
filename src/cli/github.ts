#!/usr/bin/env ts-node
/**
 * GitHub CLI Tool
 * ──────────────────────────────────────────────────────
 * ให้ Claude Code sub-agents เรียกผ่าน Bash:
 *
 *   npx ts-node src/cli/github.ts <command> '<json-args>'
 *
 * Commands:
 *   create-branch   '{"branchName","fromBranch?"}'
 *   create-pr       '{"title","body","headBranch","baseBranch?","draft?"}'
 *   list-prs        '{}'
 *   get-pr          '{"prNumber"}'
 *   branch-name     '{"taskTitle","taskId"}'
 */

import "dotenv/config";
import {
  createBranch,
  createPullRequest,
  listOpenPullRequests,
  getPullRequest,
  toBranchName,
} from "../tools/github";

async function main(): Promise<void> {
  const [,, command, rawArgs] = process.argv;

  if (!command) {
    console.error("Usage: github.ts <command> '<json-args>'");
    process.exit(1);
  }

  let args: Record<string, unknown> = {};
  if (rawArgs) {
    try { args = JSON.parse(rawArgs); }
    catch { console.error("Invalid JSON args"); process.exit(1); }
  }

  let result;

  switch (command) {
    case "create-branch":
      result = await createBranch({
        branchName: args.branchName as string,
        fromBranch: args.fromBranch as string | undefined,
      });
      break;

    case "create-pr":
      result = await createPullRequest({
        title: args.title as string,
        body: args.body as string,
        headBranch: args.headBranch as string,
        baseBranch: args.baseBranch as string | undefined,
        draft: args.draft as boolean | undefined,
      });
      break;

    case "list-prs":
      result = await listOpenPullRequests();
      break;

    case "get-pr":
      result = await getPullRequest(args.prNumber as number);
      break;

    case "branch-name":
      result = {
        success: true,
        data: { branchName: toBranchName(args.taskTitle as string, args.taskId as string) },
      };
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: String(err) }));
  process.exit(1);
});
