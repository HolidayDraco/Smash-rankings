import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only diffs the schema against the committed snapshots,
// so it needs no database URL. Migrations are applied by `pnpm db:migrate`
// (src/migrate-cli.ts), which reads DATABASE_URL through @sr/core's loadEnv.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
});
