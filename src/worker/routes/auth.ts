import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, apiKeys } from "../../db";
import { generateApiKey } from "../lib/keys";
import { sendLoginCode, resolveAccountFromCode } from "../lib/auth-flow";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { InvalidBodyError, PayloadTooLargeError, readJsonWithLimit } from "../lib/body";
import { hashOpaqueToken } from "../lib/keys";
import { normalizeEmail, ValidationError } from "../lib/validation";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/signup", async (c) => {
	let email: string;
	try {
		const body = await readJsonWithLimit<{ email?: unknown }>(c.req.raw, 16 * 1024);
		email = normalizeEmail(body.email);
	} catch (error) {
		if (error instanceof PayloadTooLargeError) return c.json({ error: error.message }, 413);
		if (error instanceof InvalidBodyError || error instanceof ValidationError) return c.json({ error: error.message }, 400);
		throw error;
	}

	const emailKey = await hashOpaqueToken(email);
	const [ipAllowed, emailAllowed] = await Promise.all([
		checkRateLimit(c.env.LOGIN_CODE_RATE_LIMITER, `ip:${clientIp(c.req.raw)}`),
		checkRateLimit(c.env.LOGIN_CODE_RATE_LIMITER, `email:${emailKey}`),
	]);
	if (!ipAllowed || !emailAllowed) {
		return c.json({ error: "too many requests, try again shortly" }, 429);
	}

	await sendLoginCode(c.env, email, c.executionCtx);
	return c.json({ ok: true });
});

app.post("/verify", async (c) => {
	let email: string;
	let code: string;
	try {
		const body = await readJsonWithLimit<{ email?: unknown; code?: unknown }>(c.req.raw, 16 * 1024);
		email = normalizeEmail(body.email);
		code = typeof body.code === "string" ? body.code.trim() : "";
		if (!/^\d{6}$/.test(code)) throw new ValidationError("email and six-digit code required");
	} catch (error) {
		if (error instanceof PayloadTooLargeError) return c.json({ error: error.message }, 413);
		if (error instanceof InvalidBodyError || error instanceof ValidationError) return c.json({ error: error.message }, 400);
		throw error;
	}

	const emailKey = await hashOpaqueToken(email);
	const [ipAllowed, emailAllowed] = await Promise.all([
		checkRateLimit(c.env.VERIFY_RATE_LIMITER, `ip:${clientIp(c.req.raw)}`),
		checkRateLimit(c.env.VERIFY_RATE_LIMITER, `email:${emailKey}`),
	]);
	if (!ipAllowed || !emailAllowed) {
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

	c.header("cache-control", "no-store");
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
	let body: { name?: unknown } = {};
	try {
		body = await readJsonWithLimit<{ name?: unknown }>(c.req.raw, 16 * 1024);
	} catch (error) {
		if (!(error instanceof InvalidBodyError && error.message === "request body required")) {
			if (error instanceof PayloadTooLargeError) return c.json({ error: error.message }, 413);
			if (error instanceof InvalidBodyError) return c.json({ error: error.message }, 400);
			throw error;
		}
	}
	const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 64) : "unnamed";

	const { key, keyHash, keyPrefix } = await generateApiKey();
	const db = getDb(c.env.DB);
	await db.insert(apiKeys).values({
		accountId: c.get("accountId"),
		name,
		keyHash,
		keyPrefix,
	});

	c.header("cache-control", "no-store");
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
