import type { Config } from "drizzle-kit";

const dbUrl = process.env.DATABASE_URL ?? "file:./data/dashboard.db";

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbUrl.replace(/^file:/, ""),
  },
} satisfies Config;
