import { Client } from "@notionhq/client";
import type {
  QueryDatabaseParameters,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";
import { config } from "../config";
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  BugReport,
  BugSeverity,
  BugStatus,
  Release,
  ReleaseStatus,
  ToolResult,
} from "./types";

const notion = new Client({ auth: config.notion.apiKey });

// Type aliases derived from the Notion SDK to avoid fighting its complex union types
type NotionFilter = QueryDatabaseParameters["filter"];
type NotionPageProperties = UpdatePageParameters["properties"];

// Collapses an array of single-property filters:
//   0 clauses -> undefined
//   1 clause  -> the clause itself (no wrapping)
//   2+ clauses -> { and: [...] }
// The cast is safe: every clause we push is a PropertyFilter
function buildAndFilter(clauses: NonNullable<NotionFilter>[]): NotionFilter {
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { and: clauses } as Extract<NotionFilter, { and: unknown[] }>;
}

// ─── Database IDs (loaded lazily from env or setup) ───────────────────────────

function getDbIds() {
  return {
    backlog: config.notion.backlogDbId,
    bugs: config.notion.bugReportsDbId,
    releases: config.notion.releasesDbId,
  };
}

// ─── Setup: Create all databases under a parent page ─────────────────────────

export async function setupNotionWorkspace(): Promise<{
  backlogDbId: string;
  bugReportsDbId: string;
  releasesDbId: string;
}> {
  console.log("Setting up Notion workspace...");

  const backlogDb = await notion.databases.create({
    parent: { type: "page_id", page_id: config.notion.parentPageId },
    title: [{ type: "text", text: { content: "📋 Backlog" } }],
    properties: {
      Name: { title: {} },
      Status: {
        select: {
          options: [
            { name: "Backlog", color: "gray" },
            { name: "In Progress", color: "blue" },
            { name: "In Review", color: "yellow" },
            { name: "QA", color: "purple" },
            { name: "Done", color: "green" },
            { name: "Blocked", color: "red" },
          ],
        },
      },
      Priority: {
        select: {
          options: [
            { name: "Critical", color: "red" },
            { name: "High", color: "orange" },
            { name: "Medium", color: "yellow" },
            { name: "Low", color: "gray" },
          ],
        },
      },
      Type: {
        select: {
          options: [
            { name: "Feature", color: "blue" },
            { name: "Bug Fix", color: "red" },
            { name: "Chore", color: "gray" },
            { name: "Research", color: "purple" },
          ],
        },
      },
      Assignee: { rich_text: {} },
      Release: { rich_text: {} },
      "Work Log": { rich_text: {} },
      "PR URL": { url: {} },
      Description: { rich_text: {} },
    },
  });

  const bugDb = await notion.databases.create({
    parent: { type: "page_id", page_id: config.notion.parentPageId },
    title: [{ type: "text", text: { content: "🐛 Bug Reports" } }],
    properties: {
      Name: { title: {} },
      Status: {
        select: {
          options: [
            { name: "Open", color: "red" },
            { name: "In Progress", color: "blue" },
            { name: "Fixed", color: "green" },
            { name: "Closed", color: "gray" },
            { name: "Wont Fix", color: "orange" },
          ],
        },
      },
      Severity: {
        select: {
          options: [
            { name: "Critical", color: "red" },
            { name: "High", color: "orange" },
            { name: "Medium", color: "yellow" },
            { name: "Low", color: "gray" },
          ],
        },
      },
      "Related Task ID": { rich_text: {} },
      Release: { rich_text: {} },
      Description: { rich_text: {} },
      "Steps to Reproduce": { rich_text: {} },
    },
  });

  const releasesDb = await notion.databases.create({
    parent: { type: "page_id", page_id: config.notion.parentPageId },
    title: [{ type: "text", text: { content: "🚀 Releases" } }],
    properties: {
      Name: { title: {} },
      Status: {
        select: {
          options: [
            { name: "Planning", color: "gray" },
            { name: "In Progress", color: "blue" },
            { name: "Released", color: "green" },
            { name: "Cancelled", color: "red" },
          ],
        },
      },
      Version: { rich_text: {} },
      Features: { rich_text: {} },
      "Bug Count": { number: {} },
      "Release Notes": { rich_text: {} },
    },
  });

  console.log("✅ Notion workspace created.");
  console.log(`NOTION_BACKLOG_DB_ID=${backlogDb.id}`);
  console.log(`NOTION_BUG_REPORTS_DB_ID=${bugDb.id}`);
  console.log(`NOTION_RELEASES_DB_ID=${releasesDb.id}`);

  return {
    backlogDbId: backlogDb.id,
    bugReportsDbId: bugDb.id,
    releasesDbId: releasesDb.id,
  };
}

// ─── Shared Notion page shape ───────────────────────────────────────────────
type NotionProp = {
  select?: { name: string };
  rich_text?: { plain_text: string }[];
  url?: string;
  title?: { plain_text: string }[];
  number?: number;
};
type NotionPage = {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProp>;
};

// ─── Task helpers ─────────────────────────────────────────────────────────────

function pageToTask(page: Record<string, unknown>): Task {
  const p = page as unknown as NotionPage;
  const props = p.properties;
  return {
    id: p.id,
    title: props.Name?.title?.[0]?.plain_text ?? "",
    description: props.Description?.rich_text?.[0]?.plain_text ?? "",
    status: (props.Status?.select?.name ?? "Backlog") as TaskStatus,
    priority: (props.Priority?.select?.name ?? "Medium") as TaskPriority,
    type: (props.Type?.select?.name ?? "Feature") as TaskType,
    assignee: props.Assignee?.rich_text?.[0]?.plain_text ?? "",
    release: props.Release?.rich_text?.[0]?.plain_text ?? "",
    workLog: props["Work Log"]?.rich_text?.[0]?.plain_text ?? "",
    prUrl: props["PR URL"]?.url ?? "",
    createdAt: p.created_time,
    updatedAt: p.last_edited_time,
  };
}

// ─── Task CRUD ────────────────────────────────────────────────────────────────

export async function createTask(input: {
  title: string;
  description: string;
  priority: TaskPriority;
  type: TaskType;
  release: string;
}): Promise<ToolResult> {
  try {
    const { backlog } = getDbIds();
    const page = await notion.pages.create({
      parent: { database_id: backlog },
      properties: {
        Name: { title: [{ text: { content: input.title } }] },
        Status: { select: { name: "Backlog" } },
        Priority: { select: { name: input.priority } },
        Type: { select: { name: input.type } },
        Release: { rich_text: [{ text: { content: input.release } }] },
        Description: { rich_text: [{ text: { content: input.description } }] },
      },
    });
    return { success: true, data: pageToTask(page as Record<string, unknown>) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getTasks(filter?: {
  status?: TaskStatus;
  assignee?: string;
  release?: string;
}): Promise<ToolResult> {
  try {
    const { backlog } = getDbIds();
    const clauses: NonNullable<NotionFilter>[] = [];

    if (filter?.status) {
      clauses.push({ property: "Status", select: { equals: filter.status } });
    }
    if (filter?.assignee) {
      clauses.push({ property: "Assignee", rich_text: { contains: filter.assignee } });
    }
    if (filter?.release) {
      clauses.push({ property: "Release", rich_text: { contains: filter.release } });
    }

    const response = await notion.databases.query({
      database_id: backlog,
      filter: buildAndFilter(clauses),
      sorts: [{ property: "Priority", direction: "ascending" }],
    });

    const tasks = response.results.map((p) => pageToTask(p as Record<string, unknown>));
    return { success: true, data: tasks };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateTask(
  taskId: string,
  updates: Partial<{
    status: TaskStatus;
    assignee: string;
    workLog: string;
    prUrl: string;
    priority: TaskPriority;
  }>
): Promise<ToolResult> {
  try {
    const properties: NotionPageProperties = {};
    if (updates.status !== undefined) properties!["Status"] = { select: { name: updates.status } };
    if (updates.assignee !== undefined) properties!["Assignee"] = { rich_text: [{ text: { content: updates.assignee } }] };
    if (updates.workLog !== undefined) properties!["Work Log"] = { rich_text: [{ text: { content: updates.workLog } }] };
    if (updates.prUrl !== undefined) properties!["PR URL"] = { url: updates.prUrl };
    if (updates.priority !== undefined) properties!["Priority"] = { select: { name: updates.priority } };

    const page = await notion.pages.update({ page_id: taskId, properties });
    return { success: true, data: pageToTask(page as Record<string, unknown>) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Bug Report CRUD ──────────────────────────────────────────────────────────

function pageToBug(page: Record<string, unknown>): BugReport {
  const p = page as unknown as NotionPage;
  const props = p.properties;
  return {
    id: p.id,
    title: props.Name?.title?.[0]?.plain_text ?? "",
    description: props.Description?.rich_text?.[0]?.plain_text ?? "",
    stepsToReproduce: props["Steps to Reproduce"]?.rich_text?.[0]?.plain_text ?? "",
    severity: (props.Severity?.select?.name ?? "Medium") as BugSeverity,
    status: (props.Status?.select?.name ?? "Open") as BugStatus,
    relatedTaskId: props["Related Task ID"]?.rich_text?.[0]?.plain_text ?? "",
    release: props.Release?.rich_text?.[0]?.plain_text ?? "",
    createdAt: p.created_time,
  };
}

export async function createBugReport(input: {
  title: string;
  description: string;
  stepsToReproduce: string;
  severity: BugSeverity;
  relatedTaskId: string;
  release: string;
}): Promise<ToolResult> {
  try {
    const { bugs } = getDbIds();
    const page = await notion.pages.create({
      parent: { database_id: bugs },
      properties: {
        Name: { title: [{ text: { content: input.title } }] },
        Status: { select: { name: "Open" } },
        Severity: { select: { name: input.severity } },
        "Related Task ID": { rich_text: [{ text: { content: input.relatedTaskId } }] },
        Release: { rich_text: [{ text: { content: input.release } }] },
        Description: { rich_text: [{ text: { content: input.description } }] },
        "Steps to Reproduce": { rich_text: [{ text: { content: input.stepsToReproduce } }] },
      },
    });
    return { success: true, data: pageToBug(page as Record<string, unknown>) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getBugReports(filter?: {
  status?: BugStatus;
  release?: string;
}): Promise<ToolResult> {
  try {
    const { bugs } = getDbIds();
    const clauses: NonNullable<NotionFilter>[] = [];
    if (filter?.status) clauses.push({ property: "Status", select: { equals: filter.status } });
    if (filter?.release) clauses.push({ property: "Release", rich_text: { contains: filter.release } });

    const response = await notion.databases.query({
      database_id: bugs,
      filter: buildAndFilter(clauses),
    });
    return { success: true, data: response.results.map((p) => pageToBug(p as Record<string, unknown>)) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateBugReport(
  bugId: string,
  updates: Partial<{ status: BugStatus }>
): Promise<ToolResult> {
  try {
    const properties: NotionPageProperties = {};
    if (updates.status !== undefined) properties!["Status"] = { select: { name: updates.status } };
    const page = await notion.pages.update({ page_id: bugId, properties });
    return { success: true, data: pageToBug(page as Record<string, unknown>) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Release CRUD ─────────────────────────────────────────────────────────────

function pageToRelease(page: Record<string, unknown>): Release {
  const p = page as unknown as NotionPage;
  const props = p.properties;
  return {
    id: p.id,
    name: props.Name?.title?.[0]?.plain_text ?? "",
    version: props.Version?.rich_text?.[0]?.plain_text ?? "",
    status: (props.Status?.select?.name ?? "Planning") as ReleaseStatus,
    features: props.Features?.rich_text?.[0]?.plain_text ?? "",
    bugCount: props["Bug Count"]?.number ?? 0,
    releaseNotes: props["Release Notes"]?.rich_text?.[0]?.plain_text ?? "",
    createdAt: p.created_time,
  };
}

export async function createRelease(input: {
  name: string;
  version: string;
  features: string;
  releaseNotes: string;
}): Promise<ToolResult> {
  try {
    const { releases } = getDbIds();
    const page = await notion.pages.create({
      parent: { database_id: releases },
      properties: {
        Name: { title: [{ text: { content: input.name } }] },
        Status: { select: { name: "Planning" } },
        Version: { rich_text: [{ text: { content: input.version } }] },
        Features: { rich_text: [{ text: { content: input.features } }] },
        "Bug Count": { number: 0 },
        "Release Notes": { rich_text: [{ text: { content: input.releaseNotes } }] },
      },
    });
    return { success: true, data: pageToRelease(page as Record<string, unknown>) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateRelease(
  releaseId: string,
  updates: Partial<{ status: ReleaseStatus; bugCount: number; releaseNotes: string }>
): Promise<ToolResult> {
  try {
    const properties: NotionPageProperties = {};
    if (updates.status !== undefined) properties!["Status"] = { select: { name: updates.status } };
    if (updates.bugCount !== undefined) properties!["Bug Count"] = { number: updates.bugCount };
    if (updates.releaseNotes !== undefined) properties!["Release Notes"] = { rich_text: [{ text: { content: updates.releaseNotes } }] };
    const page = await notion.pages.update({ page_id: releaseId, properties });
    return { success: true, data: pageToRelease(page as Record<string, unknown>) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getReleases(filter?: { status?: ReleaseStatus }): Promise<ToolResult> {
  try {
    const { releases } = getDbIds();
    const response = await notion.databases.query({
      database_id: releases,
      filter: filter?.status
        ? { property: "Status", select: { equals: filter.status } }
        : undefined,
    });
    return { success: true, data: response.results.map((p) => pageToRelease(p as Record<string, unknown>)) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
