import { Hono } from "hono";
import { and, eq, sql, isNull, or, gt } from "drizzle-orm";
import { getDb, links } from "../../db";

const app = new Hono<{ Bindings: Env }>();

app.get("/:slug", async (c) => {
	const db = getDb(c.env.DB);
	const slug = c.req.param("slug");

	const [link] = await db
		.select()
		.from(links)
		.where(
			and(
				eq(links.slug, slug),
				or(isNull(links.expiresAt), gt(links.expiresAt, new Date())),
			),
		)
		.limit(1);

	if (!link) {
		// not a short link — fall through to static assets (favicon, logos,
		// etc.) since run_worker_first means nothing does this automatically
		return c.env.ASSETS.fetch(c.req.raw);
	}

	c.executionCtx.waitUntil(
		db
			.update(links)
			.set({ clicks: sql`${links.clicks} + 1` })
			.where(eq(links.id, link.id))
			.run(),
	);

	return c.redirect(link.targetUrl, 302);
});

export default app;
