/**
 * One-time Notion workspace setup script.
 * Creates all databases under the NOTION_PARENT_PAGE_ID.
 *
 * Run:  npx ts-node src/setup-notion.ts
 *
 * After running, copy the printed DB IDs into your .env file.
 */

import "dotenv/config";
import { setupNotionWorkspace, createMetricsDb } from "./tools/notion";
import * as fs from "fs";
import * as path from "path";

async function main(): Promise<void> {
  console.log("Setting up Notion workspace...\n");

  try {
    const ids = await setupNotionWorkspace();
    const metricsDbId = await createMetricsDb();

    console.log("\nDone! Copy these into your .env file:\n");
    console.log(`NOTION_BACKLOG_DB_ID=${ids.backlogDbId}`);
    console.log(`NOTION_BUG_REPORTS_DB_ID=${ids.bugReportsDbId}`);
    console.log(`NOTION_RELEASES_DB_ID=${ids.releasesDbId}`);
    console.log(`NOTION_METRICS_DB_ID=${metricsDbId}`);

    // Auto-append to .env if it exists
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, "utf-8");
      const updates: Record<string, string> = {
        NOTION_BACKLOG_DB_ID: ids.backlogDbId,
        NOTION_BUG_REPORTS_DB_ID: ids.bugReportsDbId,
        NOTION_RELEASES_DB_ID: ids.releasesDbId,
        NOTION_METRICS_DB_ID: metricsDbId,
      };

      for (const [key, value] of Object.entries(updates)) {
        if (envContent.includes(`${key}=`)) {
          envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}`;
        }
      }

      fs.writeFileSync(envPath, envContent);
      console.log("\n.env file updated automatically.");
    } else {
      console.log("\nNo .env file found. Copy the IDs above manually.");
    }
  } catch (err) {
    console.error("Setup failed:", err);
    process.exit(1);
  }
}

main();
