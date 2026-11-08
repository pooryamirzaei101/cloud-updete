import { access, constants, mkdir, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const failures = [];
const checks = [];

async function check(name, task) {
  try {
    const detail = await task();
    checks.push({ name, ok: true, detail });
  } catch (error) {
    failures.push(name);
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

await check("Supabase Postgres", async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, ssl: ["false", "disable", "disabled"].includes(process.env.DATABASE_SSL?.trim().toLowerCase() ?? "") ? false : "require" });
  try {
    const [row] = await sql`select current_database() as database, now() as checked_at`;
    return `connected to ${row.database}`;
  } finally {
    await sql.end({ timeout: 2 });
  }
});

await check("Supabase Auth", async () => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !publicKey) throw new Error("Supabase URL or publishable key is missing");
  const response = await fetch(`${base}/auth/v1/health`, { headers: { apikey: publicKey }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`health endpoint returned HTTP ${response.status}`);
  return "reachable";
});

await check("Private media directory", async () => {
  const root = process.env.MEDIA_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error("MEDIA_ROOT must be an absolute path");
  await mkdir(root, { recursive: true, mode: 0o750 });
  await access(root, constants.R_OK | constants.W_OK);
  const probe = path.join(root, `.write-check-${crypto.randomUUID()}`);
  await writeFile(probe, "ok", { mode: 0o600 });
  await rm(probe, { force: true });
  const disk = await statfs(root);
  const freeGiB = Number(disk.bavail * disk.bsize) / 1024 ** 3;
  const minimum = Number(process.env.MIN_FREE_GIB || 10);
  if (freeGiB < minimum) throw new Error(`${freeGiB.toFixed(1)} GiB free; at least ${minimum} GiB required`);
  return `writable, ${freeGiB.toFixed(1)} GiB free`;
});

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}: ${item.detail}`);
if (failures.length) process.exitCode = 1;
