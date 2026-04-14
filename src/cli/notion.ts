#!/usr/bin/env ts-node
/**
 * Notion CLI Tool
 * ──────────────────────────────────────────────────────
 * ให้ Claude Code sub-agents เรียกผ่าน Bash:
 *
 *   npx ts-node src/cli/notion.ts <command> '<json-args>'
 *
 * Commands:
 *   create-task       '{"title","description","priority","type","release"}'
 *   get-tasks         '{"status?","release?","assignee?"}'
 *   update-task       '{"taskId","status?","assignee?","workLog?","prUrl?","priority?"}'
 *   create-bug        '{"title","description","stepsToReproduce","severity","relatedTaskId","release"}'
 *   get-bugs          '{"status?","release?"}'
 *   update-bug        '{"bugId","status"}'
 *   create-release    '{"name","version","features","releaseNotes"}'
 *   get-releases      '{"status?"}'
 *   update-release    '{"releaseId","status?","bugCount?","releaseNotes?"}'
 */

import "dotenv/config";
import {
  createTask, getTasks, updateTask,
  createBugReport, getBugReports, updateBugReport,
  createRelease, getReleases, updateRelease,
} from "../tools/notion";
import type {
  TaskStatus, TaskPriority, TaskType,
  BugSeverity, BugStatus, ReleaseStatus,
} from "../tools/types";

async function main(): Promise<void> {
  const [,, command, rawArgs] = process.argv;

  if (!command) {
    console.error("Usage: notion.ts <command> '<json-args>'");
    process.exit(1);
  }

  let args: Record<string, unknown> = {};
  if (rawArgs) {
    try { args = JSON.parse(rawArgs); }
    catch { console.error("Invalid JSON args"); process.exit(1); }
  }

  let result;

  switch (command) {
    case "create-task":
      result = await createTask({
        title: args.title as string,
        description: args.description as string,
        priority: args.priority as TaskPriority,
        type: args.type as TaskType,
        release: args.release as string,
      });
      break;

    case "get-tasks":
      result = await getTasks({
        status: args.status as TaskStatus | undefined,
        release: args.release as string | undefined,
        assignee: args.assignee as string | undefined,
      });
      break;

    case "update-task":
      result = await updateTask(args.taskId as string, {
        status: args.status as TaskStatus | undefined,
        assignee: args.assignee as string | undefined,
        workLog: args.workLog as string | undefined,
        prUrl: args.prUrl as string | undefined,
        priority: args.priority as TaskPriority | undefined,
      });
      break;

    case "create-bug":
      result = await createBugReport({
        title: args.title as string,
        description: args.description as string,
        stepsToReproduce: args.stepsToReproduce as string,
        severity: args.severity as BugSeverity,
        relatedTaskId: args.relatedTaskId as string,
        release: args.release as string,
      });
      break;

    case "get-bugs":
      result = await getBugReports({
        status: args.status as BugStatus | undefined,
        release: args.release as string | undefined,
      });
      break;

    case "update-bug":
      result = await updateBugReport(args.bugId as string, {
        status: args.status as BugStatus,
      });
      break;

    case "create-release":
      result = await createRelease({
        name: args.name as string,
        version: args.version as string,
        features: args.features as string,
        releaseNotes: args.releaseNotes as string,
      });
      break;

    case "get-releases":
      result = await getReleases({
        status: args.status as ReleaseStatus | undefined,
      });
      break;

    case "update-release":
      result = await updateRelease(args.releaseId as string, {
        status: args.status as ReleaseStatus | undefined,
        bugCount: args.bugCount as number | undefined,
        releaseNotes: args.releaseNotes as string | undefined,
      });
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
