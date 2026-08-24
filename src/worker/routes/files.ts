import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, files } from "../../db";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { requireCreateRateLimit } from "../middleware/rate-limit";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import {
	claimUploadToken,
	createFileFromBytes,
	createUploadToken,
	finalizeClaimedUpload,
	FileUploadError,
	MAX_FILE_BYTES,
} from "../lib/files";
import {
	assertDeclaredBodyWithinLimit,
	InvalidBodyError,
	PayloadTooLargeError,
	readBodyWithLimit,
	readJsonWithLimit,
} from "../lib/body";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Mints a short-lived, single-use upload token — no file bytes here, just
// metadata. Whoever holds the token PUTs the raw file to /upload/:token.
app.post("/", requireAuth, requireCreateRateLimit, async (c) => {
	let body: Record<string, unknown>;
	try {
		body = await readJsonWithLimit(c.req.raw, 32 * 1024);
	} catch (error) {
		if (error instanceof PayloadTooLargeError) return c.json({ error: error.message }, 413);
		if (error instanceof InvalidBodyError) return c.json({ error: error.message }, 400);
		throw error;
	}
	const filename = typeof body?.filename === "string" ? body.filename : "";
	const contentType = typeof body?.contentType === "string" ? body.contentType : undefined;
	const slug = typeof body?.slug === "string" ? body.slug.trim() : undefined;
	const expiresIn = typeof body?.expiresIn === "number" ? body.expiresIn : undefined;

	try {
		const { token, expiresAt } = await createUploadToken(getDb(c.env.DB), c.get("accountId"), { filename, contentType, slug, expiresIn });
		const uploadUrl = new URL(`/v1/files/upload/${token}`, c.req.url).toString();
		return c.json({ uploadUrl, expiresAt }, 201);
	} catch (err) {
		if (err instanceof FileUploadError) return c.json({ error: err.message }, 400);
		throw err;
	}
});

// No requireAuth here — the token itself is the one-time credential, so any
// client holding it (e.g. an agent with local file access but no API key) can
// complete the upload with a plain, unauthenticated PUT of the raw bytes.
app.put("/upload/:token", async (c) => {
	if (!(await checkRateLimit(c.env.CREATE_RATE_LIMITER, clientIp(c.req.raw)))) {
		return c.json({ error: "rate limit exceeded, try again shortly" }, 429);
	}

	try {
		assertDeclaredBodyWithinLimit(c.req.raw, MAX_FILE_BYTES);
		const db = getDb(c.env.DB);
		const claimed = await claimUploadToken(db, c.req.param("token"));
		if (!claimed) return c.json({ error: "upload token invalid, expired, or already used" }, 400);
		const bytes = await readBodyWithLimit(c.req.raw, MAX_FILE_BYTES);
		const file = await finalizeClaimedUpload(db, c.env, claimed, bytes, c.req.url);
		return c.json(file, 201);
	} catch (err) {
		if (err instanceof PayloadTooLargeError) return c.json({ error: err.message }, 413);
		if (err instanceof InvalidBodyError) return c.json({ error: err.message }, 400);
		if (err instanceof FileUploadError) return c.json({ error: err.message }, 400);
		throw err;
	}
});

// Raw-body upload: the file is the literal request body (e.g. `curl -T file.png`),
// so it never has to be base64-inflated or buffered as JSON. Metadata rides in
// the query string since the body is opaque bytes.
app.put("/", requireAuth, requireCreateRateLimit, async (c) => {
	const filename = c.req.query("filename") ?? "";
	const slug = c.req.query("slug")?.trim() || undefined;
	const expiresInRaw = c.req.query("expiresIn");
	const expiresIn = expiresInRaw ? Number(expiresInRaw) : undefined;
	const contentType = c.req.header("content-type") || undefined;

	if (expiresIn !== undefined && !Number.isFinite(expiresIn)) {
		return c.json({ error: "expiresIn must be a number" }, 400);
	}

	try {
		const bytes = await readBodyWithLimit(c.req.raw, MAX_FILE_BYTES);
		const file = await createFileFromBytes(
			getDb(c.env.DB),
			c.env,
			c.get("accountId"),
			bytes,
			{ filename, contentType, slug, expiresIn },
			c.req.url,
		);
		return c.json(file, 201);
	} catch (err) {
		if (err instanceof PayloadTooLargeError) return c.json({ error: err.message }, 413);
		if (err instanceof InvalidBodyError) return c.json({ error: err.message }, 400);
		if (err instanceof FileUploadError) return c.json({ error: err.message }, 400);
		throw err;
	}
});

app.get("/", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const rows = await db
		.select({
			id: files.id,
			slug: files.slug,
			filename: files.filename,
			contentType: files.contentType,
			sizeBytes: files.sizeBytes,
			createdAt: files.createdAt,
			expiresAt: files.expiresAt,
		})
		.from(files)
		.where(eq(files.accountId, c.get("accountId")));
	return c.json({ files: rows });
});

app.delete("/:slug", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const [file] = await db
		.select()
		.from(files)
		.where(and(eq(files.slug, c.req.param("slug")), eq(files.accountId, c.get("accountId"))))
		.limit(1);
	if (!file) return c.json({ error: "not found" }, 404);

	await c.env.R2.delete(file.r2Key);
	await db.delete(files).where(eq(files.id, file.id));
	return c.json({ ok: true });
});

export default app;
