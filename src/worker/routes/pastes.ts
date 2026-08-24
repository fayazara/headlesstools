import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, pastes } from "../../db";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { requireCreateRateLimit } from "../middleware/rate-limit";
import { createPaste, PasteError, resolvePaste } from "../lib/pastes";
import { InvalidBodyError, PayloadTooLargeError, readJsonWithLimit } from "../lib/body";
import { MAX_PASTE_BYTES } from "../lib/quotas";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/", requireAuth, requireCreateRateLimit, async (c) => {
	let body: Record<string, unknown>;
	try {
		body = await readJsonWithLimit(c.req.raw, MAX_PASTE_BYTES * 2 + 64 * 1024);
	} catch (error) {
		if (error instanceof PayloadTooLargeError) return c.json({ error: error.message }, 413);
		if (error instanceof InvalidBodyError) return c.json({ error: error.message }, 400);
		throw error;
	}
	const content = typeof body?.content === "string" ? body.content : "";
	const language = typeof body?.language === "string" ? body.language : undefined;
	const requestedSlug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
	const expiresInSeconds = typeof body?.expiresIn === "number" ? body.expiresIn : undefined;
	const visibility = body?.visibility === "private" ? "private" : "unlisted";
	const burnAfterRead = Boolean(body?.burnAfterRead);

	const db = getDb(c.env.DB);
	try {
		const paste = await createPaste(db, c.env, c.get("accountId"), {
			content,
			language,
			slug: requestedSlug,
			expiresIn: expiresInSeconds,
			visibility,
			burnAfterRead,
		});
		const url = new URL(`/p/${paste.slug}`, c.req.url).toString();
		return c.json(
			{ slug: paste.slug, url, sizeBytes: paste.sizeBytes, visibility: paste.visibility, createdAt: paste.createdAt },
			201,
		);
	} catch (error) {
		if (error instanceof PasteError) return c.json({ error: error.message }, error.message.includes("taken") ? 409 : 400);
		throw error;
	}
});

app.get("/", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const rows = await db
		.select({
			id: pastes.id,
			slug: pastes.slug,
			language: pastes.language,
			sizeBytes: pastes.sizeBytes,
			visibility: pastes.visibility,
			createdAt: pastes.createdAt,
			expiresAt: pastes.expiresAt,
		})
		.from(pastes)
		.where(eq(pastes.accountId, c.get("accountId")));
	return c.json({ pastes: rows });
});

app.get("/:slug", async (c) => {
	const db = getDb(c.env.DB);
	const result = await resolvePaste(db, c.env, c.req.param("slug"), c.req.header("Authorization") ?? null);
	if (result === "not_found") return c.json({ error: "not found" }, 404);

	const { paste, content } = result;
	return c.json({
		slug: paste.slug,
		content,
		language: paste.language,
		sizeBytes: paste.sizeBytes,
		createdAt: paste.createdAt,
	});
});

app.delete("/:slug", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const [paste] = await db
		.select()
		.from(pastes)
		.where(and(eq(pastes.slug, c.req.param("slug")), eq(pastes.accountId, c.get("accountId"))))
		.limit(1);

	if (!paste) return c.json({ error: "not found" }, 404);
	if (paste.r2Key) await c.env.R2.delete(paste.r2Key);
	await db.delete(pastes).where(eq(pastes.id, paste.id));

	return c.json({ ok: true });
});

export default app;
