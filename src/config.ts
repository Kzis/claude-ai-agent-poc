import "dotenv/config";

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const config = {
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: "claude-opus-4-6" as const,
  },
  notion: {
    apiKey: required("NOTION_API_KEY"),
    parentPageId: required("NOTION_PARENT_PAGE_ID"),
    backlogDbId: optional("NOTION_BACKLOG_DB_ID"),
    bugReportsDbId: optional("NOTION_BUG_REPORTS_DB_ID"),
    releasesDbId: optional("NOTION_RELEASES_DB_ID"),
    metricsDbId: optional("NOTION_METRICS_DB_ID"),
  },
  github: {
    token: required("GH_TOKEN"),
    owner: required("GH_OWNER"),
    repo: required("GH_REPO"),
    baseBranch: optional("GH_BASE_BRANCH", "main"),
  },
};
