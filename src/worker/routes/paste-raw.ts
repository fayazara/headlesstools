import { Hono } from "hono";
import { getDb } from "../../db";
import { resolvePaste } from "../lib/pastes";

const app = new Hono<{ Bindings: Env }>();

app.get("/:slug", async (c) => {
	const db = getDb(c.env.DB);
	const result = await resolvePaste(db, c.env, c.req.param("slug"), c.req.header("Authorization") ?? null);
	if (result === "not_found") return c.notFound();

	// Always text/plain, regardless of the paste's `language` label - pastes
	// are user-supplied content, so serving as text/html would be a stored XSS
	// vector against anyone who opens the share link.
	return new Response(result.content ?? "", {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
		},
	});
});

export default app;
