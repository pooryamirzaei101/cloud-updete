import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { getVpsMediaStore } from "@/lib/vps-media-store";

let database: any;

function d1Compatible<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, property) {
      if (property === "get") {
        return async () => {
          const rows = await (target as any);
          return rows[0];
        };
      }
      if (property === "all") return async () => await (target as any);
      const member = Reflect.get(target, property, target);
      if (property === "then" && typeof member === "function") return member.bind(target);
      if (typeof member === "function") {
        return (...args: unknown[]) => {
          const result = member.apply(target, args);
          return result && typeof result === "object" ? d1Compatible(result) : result;
        };
      }
      return member;
    },
  });
}

export function getDb(): any {
  if (database) return database;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const client = postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_SIZE || 8),
    idle_timeout: 20,
    connect_timeout: 15,
    // "false", "disable" and "disabled" all turn TLS off (same values as scripts/verify-vps.mjs).
    ssl: ["false", "disable", "disabled"].includes(process.env.DATABASE_SSL?.trim().toLowerCase() ?? "") ? false : "require",
  });
  database = d1Compatible(drizzle(client, { schema }));
  return database;
}

export function getMediaBucket() {
  return getVpsMediaStore();
}
