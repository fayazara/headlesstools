import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, apiKeys } from "../../db";
import { generateApiKey } from "../lib/keys";
import { sendLoginCode, resolveAccountFromCode } from "../lib/auth-flow";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import { requireAuth, type AuthVariables } from "../middleware/auth";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/signup", async (c) => {
	const body = await c.req.json().catch(() => null);
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	if (!email || !email.includes("@")) {
		return c.json({ error: "valid email required" }, 400);
	}

	if (!(await checkRateLimit(c.env.LOGIN_CODE_RATE_LIMITER, clientIp(c.req.raw)))) {
		return c.json({ error: "too many requests, try again shortly" }, 429);
	}

	await sendLoginCode(getDb(c.env.DB), c.env, email);
	return c.json({ ok: true });
});

app.post("/verify", async (c) => {
	const body = await c.req.json().catch(() => null);
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const code = typeof body?.code === "string" ? body.code.trim() : "";
	if (!email || !code) {
		return c.json({ error: "email and code required" }, 400);
	}

	if (!(await checkRateLimit(c.env.VERIFY_RATE_LIMITER, clientIp(c.req.raw)))) {
		return c.json({ error: "too many attempts, try again shortly" }, 429);
	}

	const db = getDb(c.env.DB);
	const account = await resolveAccountFromCode(db, email, code);
	if (!account) {
		return c.json({ error: "invalid or expired code" }, 400);
	}

	const { key, keyHash, keyPrefix } = await generateApiKey();
	await db.insert(apiKeys).values({
		accountId: account.id,
		name: "default",
		keyHash,
		keyPrefix,
	});

	return c.json({ apiKey: key, accountId: account.id, email: account.email });
});

app.get("/keys", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const keys = await db
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			keyPrefix: apiKeys.keyPrefix,
			createdAt: apiKeys.createdAt,
			lastUsedAt: apiKeys.lastUsedAt,
			revokedAt: apiKeys.revokedAt,
		})
		.from(apiKeys)
		.where(eq(apiKeys.accountId, c.get("accountId")));

	return c.json({ keys });
});

app.post("/keys", requireAuth, async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "unnamed";

	const { key, keyHash, keyPrefix } = await generateApiKey();
	const db = getDb(c.env.DB);
	await db.insert(apiKeys).values({
		accountId: c.get("accountId"),
		name,
		keyHash,
		keyPrefix,
	});

	return c.json({ apiKey: key, name, keyPrefix });
});

app.delete("/keys/:id", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const id = c.req.param("id");

	const result = await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, c.get("accountId"))))
		.returning();

	if (result.length === 0) {
		return c.json({ error: "key not found" }, 404);
	}

	return c.json({ ok: true });
});

export default app;
