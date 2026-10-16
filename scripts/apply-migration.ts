import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { Client } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const fileName = process.argv[2];
if (!fileName || !/^[A-Za-z0-9_.-]+\.sql$/.test(fileName)) {
  console.error("Usage: bun run scripts/apply-migration.ts <migration-file.sql> (reads from supabase/migrations/)");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const sql = await readFile(new URL(`../supabase/migrations/${fileName}`, import.meta.url), "utf8");
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${fileName}.`);
} finally {
  await client.end();
}
