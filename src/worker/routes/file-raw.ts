import { Hono } from "hono";
import { getDb } from "../../db";
import { getActiveFile } from "../lib/files";

const app = new Hono<{ Bindings: Env }>();

app.get("/:slug", async (c) => {
	const db = getDb(c.env.DB);
	const file = await getActiveFile(db, c.req.param("slug"));
	if (!file) return c.notFound();

	const object = await c.env.R2.get(file.r2Key);
	if (!object) return c.notFound();

	return new Response(object.body, {
		headers: {
			"content-type": file.contentType,
			"content-disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
			"cache-control": "public, max-age=31536000, immutable",
		},
	});
});

export default app;
