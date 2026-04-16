/**
 * One-time script — creates only the Agent Metrics database in Notion
 * and writes NOTION_METRICS_DB_ID to your .env file.
 *
 * Run:  npm run setup-metrics-db
 *
 * Safe to run even if the other databases already exist.
 */

import "dotenv/config";
import { createMetricsDb } from "./tools/notion";
import * as fs from "fs";
import * as path from "path";

async function main(): Promise<void> {
  console.log("Creating Agent Metrics database in Notion...\n");

  try {
    const metricsDbId = await createMetricsDb();

    console.log("✅ Done!\n");
    console.log("NOTION_METRICS_DB_ID=" + metricsDbId);

    // Auto-write to .env
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      let env = fs.readFileSync(envPath, "utf-8");
      if (env.includes("NOTION_METRICS_DB_ID=")) {
        env = env.replace(/NOTION_METRICS_DB_ID=.*/, "NOTION_METRICS_DB_ID=" + metricsDbId);
      } else {
        env = env.trimEnd() + "\nNOTION_METRICS_DB_ID=" + metricsDbId + "\n";
      }
      fs.writeFileSync(envPath, env);
      console.log("\n✅ Written to .env automatically.");
    } else {
      console.log('\nAdd this line to your .env:\nNOTION_METRICS_DB_ID=' + metricsDbId);
    }
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
}

main();
