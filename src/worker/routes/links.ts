import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, links } from "../../db";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { requireCreateRateLimit } from "../middleware/rate-limit";
import { InvalidBodyError, PayloadTooLargeError, readJsonWithLimit } from "../lib/body";
import { createLink, LinkError } from "../lib/links";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/", requireAuth, requireCreateRateLimit, async (c) => {
	let body: { url?: unknown; slug?: unknown; expiresIn?: unknown };
	try {
		body = await readJsonWithLimit(c.req.raw, 32 * 1024);
	} catch (error) {
		if (error instanceof PayloadTooLargeError) return c.json({ error: error.message }, 413);
		if (error instanceof InvalidBodyError) return c.json({ error: error.message }, 400);
		throw error;
	}
	try {
		const link = await createLink(getDb(c.env.DB), c.get("accountId"), {
			url: typeof body.url === "string" ? body.url : "",
			slug: typeof body.slug === "string" ? body.slug.trim() : undefined,
			expiresIn: typeof body.expiresIn === "number" ? body.expiresIn : undefined,
		});

		const shortUrl = new URL(`/${link.slug}`, c.req.url).toString();
		return c.json({ slug: link.slug, shortUrl, targetUrl: link.targetUrl, createdAt: link.createdAt }, 201);
	} catch (error) {
		if (error instanceof LinkError) return c.json({ error: error.message }, error.message.includes("taken") ? 409 : 400);
		throw error;
	}
});

app.get("/", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const rows = await db.select().from(links).where(eq(links.accountId, c.get("accountId")));
	return c.json({ links: rows });
});

app.get("/:slug", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const [link] = await db
		.select()
		.from(links)
		.where(and(eq(links.slug, c.req.param("slug")), eq(links.accountId, c.get("accountId"))))
		.limit(1);

	if (!link) return c.json({ error: "not found" }, 404);
	return c.json(link);
});

app.delete("/:slug", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const result = await db
		.delete(links)
		.where(and(eq(links.slug, c.req.param("slug")), eq(links.accountId, c.get("accountId"))))
		.returning();

	if (result.length === 0) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

export default app;
