import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, pastes } from "../../db";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { requireCreateRateLimit } from "../middleware/rate-limit";
import { generateSlug } from "../lib/keys";
import { resolvePaste } from "../lib/pastes";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const INLINE_LIMIT_BYTES = 32 * 1024;

app.post("/", requireAuth, requireCreateRateLimit, async (c) => {
	const body = await c.req.json().catch(() => null);
	const content = typeof body?.content === "string" ? body.content : "";
	const language = typeof body?.language === "string" ? body.language : undefined;
	const requestedSlug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
	const expiresInSeconds = typeof body?.expiresIn === "number" ? body.expiresIn : undefined;
	const visibility = body?.visibility === "private" ? "private" : "unlisted";
	const burnAfterRead = Boolean(body?.burnAfterRead);

	if (!content) {
		return c.json({ error: "content required" }, 400);
	}
	if (requestedSlug && !/^[a-zA-Z0-9_-]{3,32}$/.test(requestedSlug)) {
		return c.json({ error: "slug must be 3-32 chars, alphanumeric/_/- only" }, 400);
	}

	const db = getDb(c.env.DB);
	const slug = requestedSlug ?? generateSlug();

	if (requestedSlug) {
		const [existing] = await db.select().from(pastes).where(eq(pastes.slug, slug)).limit(1);
		if (existing) return c.json({ error: "slug already taken" }, 409);
	}

	const bytes = new TextEncoder().encode(content);
	let inlineContent: string | undefined = content;
	let r2Key: string | undefined;

	if (bytes.byteLength > INLINE_LIMIT_BYTES) {
		r2Key = `pastes/${slug}`;
		await c.env.R2.put(r2Key, bytes);
		inlineContent = undefined;
	}

	const [paste] = await db
		.insert(pastes)
		.values({
			slug,
			accountId: c.get("accountId"),
			content: inlineContent,
			r2Key,
			sizeBytes: bytes.byteLength,
			language,
			visibility,
			burnAfterRead,
			expiresAt: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : undefined,
		})
		.returning();

	const url = new URL(`/p/${paste.slug}`, c.req.url).toString();
	return c.json(
		{ slug: paste.slug, url, sizeBytes: paste.sizeBytes, visibility: paste.visibility, createdAt: paste.createdAt },
		201,
	);
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
