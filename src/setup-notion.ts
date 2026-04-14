/**
 * One-time Notion workspace setup script.
 * Creates all three databases under the NOTION_PARENT_PAGE_ID.
 *
 * Run:  npx ts-node src/setup-notion.ts
 *
 * After running, copy the printed DB IDs into your .env file.
 */

import "dotenv/config";
import { setupNotionWorkspace } from "./tools/notion";
import * as fs from "fs";
import * as path from "path";

async function main(): Promise<void> {
  console.log("🚀 Setting up Notion workspace...\n");

  try {
    const ids = await setupNotionWorkspace();

    console.log("\n✅ Done! Copy these into your .env file:\n");
    console.log(`NOTION_BACKLOG_DB_ID=${ids.backlogDbId}`);
    console.log(`NOTION_BUG_REPORTS_DB_ID=${ids.bugReportsDbId}`);
    console.log(`NOTION_RELEASES_DB_ID=${ids.releasesDbId}`);

    // Auto-append to .env if it exists
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, "utf-8");
      const updates = {
        NOTION_BACKLOG_DB_ID: ids.backlogDbId,
        NOTION_BUG_REPORTS_DB_ID: ids.bugReportsDbId,
        NOTION_RELEASES_DB_ID: ids.releasesDbId,
      };

      for (const [key, value] of Object.entries(updates)) {
        if (envContent.includes(`${key}=`)) {
          envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}`;
        }
      }

      fs.writeFileSync(envPath, envContent);
      console.log("\n✅ .env file updated automatically.");
    } else {
      console.log("\n⚠️  No .env file found. Copy the IDs above manually.");
    }
  } catch (err) {
    console.error("❌ Setup failed:", err);
    process.exit(1);
  }
}

main();
