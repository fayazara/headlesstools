import { defineConfig } from "drizzle-kit";

// Migrations are generated here and applied via `wrangler d1 migrations apply`
// (using the authenticated wrangler session) rather than `drizzle-kit push`,
// so no D1 API token is needed locally.
export default defineConfig({
	out: "./migrations",
	schema: "./src/db/schema.ts",
	dialect: "sqlite",
});
