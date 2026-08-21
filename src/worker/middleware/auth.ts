import { createMiddleware } from "hono/factory";
import { eq, isNull, and } from "drizzle-orm";
import { getDb, apiKeys, accounts } from "../../db";
import { hashApiKey } from "../lib/keys";

export type AuthVariables = {
	accountId: string;
	apiKeyId: string;
};

export const requireAuth = createMiddleware<{
	Bindings: Env;
	Variables: AuthVariables;
}>(async (c, next) => {
	const header = c.req.header("Authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

	if (!token) {
		return c.json({ error: "missing bearer token" }, 401);
	}

	const db = getDb(c.env.DB);
	const keyHash = await hashApiKey(token);

	const [row] = await db
		.select({ id: apiKeys.id, accountId: apiKeys.accountId })
		.from(apiKeys)
		.innerJoin(accounts, eq(accounts.id, apiKeys.accountId))
		.where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
		.limit(1);

	if (!row) {
		return c.json({ error: "invalid or revoked api key" }, 401);
	}

	c.set("accountId", row.accountId);
	c.set("apiKeyId", row.id);

	c.executionCtx.waitUntil(
		db
			.update(apiKeys)
			.set({ lastUsedAt: new Date() })
			.where(eq(apiKeys.id, row.id))
			.run(),
	);

	await next();
});
