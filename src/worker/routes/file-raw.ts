import { Hono } from "hono";
import { getDb } from "../../db";
import { getActiveFile } from "../lib/files";

const app = new Hono<{ Bindings: Env }>();

const INLINE_CONTENT_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"text/plain",
]);

function contentDisposition(filename: string, inline: boolean) {
	const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
	const encoded = encodeURIComponent(filename).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
	return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

app.get("/:slug", async (c) => {
	const db = getDb(c.env.DB);
	const file = await getActiveFile(db, c.req.param("slug"));
	if (!file) return c.notFound();

	const object = await c.env.R2.get(file.r2Key);
	if (!object) return c.notFound();
	const mime = file.contentType.split(";", 1)[0].trim().toLowerCase();
	const inline = INLINE_CONTENT_TYPES.has(mime);

	return new Response(object.body, {
		headers: {
			"content-type": file.contentType,
			"content-disposition": contentDisposition(file.filename, inline),
			"cache-control": "no-store",
			"content-security-policy": "sandbox; default-src 'none'",
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "cross-origin",
		},
	});
});

export default app;
