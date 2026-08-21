import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, links } from "../../db";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { requireCreateRateLimit } from "../middleware/rate-limit";
import { generateSlug } from "../lib/keys";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

function isValidUrl(value: string): boolean {
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

app.post("/", requireAuth, requireCreateRateLimit, async (c) => {
	const body = await c.req.json().catch(() => null);
	const targetUrl = typeof body?.url === "string" ? body.url.trim() : "";
	const requestedSlug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
	const expiresInSeconds = typeof body?.expiresIn === "number" ? body.expiresIn : undefined;

	if (!isValidUrl(targetUrl)) {
		return c.json({ error: "valid http(s) url required" }, 400);
	}
	if (requestedSlug && !/^[a-zA-Z0-9_-]{3,32}$/.test(requestedSlug)) {
		return c.json({ error: "slug must be 3-32 chars, alphanumeric/_/- only" }, 400);
	}

	const db = getDb(c.env.DB);
	const slug = requestedSlug ?? generateSlug();

	if (requestedSlug) {
		const [existing] = await db.select().from(links).where(eq(links.slug, slug)).limit(1);
		if (existing) {
			return c.json({ error: "slug already taken" }, 409);
		}
	}

	const [link] = await db
		.insert(links)
		.values({
			slug,
			targetUrl,
			accountId: c.get("accountId"),
			expiresAt: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : undefined,
		})
		.returning();

	const shortUrl = new URL(`/${link.slug}`, c.req.url).toString();
	return c.json({ slug: link.slug, shortUrl, targetUrl: link.targetUrl, createdAt: link.createdAt }, 201);
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
