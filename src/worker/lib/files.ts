import { and, eq, isNull, or, gt } from "drizzle-orm";
import { files, type Db } from "../../db";
import { generateSlug } from "./keys";

// Hard cap for raw-body uploads (PUT /v1/files), where bytes are streamed
// straight from disk and never inflated into text.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Lower cap for base64-encoded uploads (MCP create_file, JSON body), since
// those bytes have to sit as text in a tool call or request body — a 5MB
// file would already be ~6.7MB of base64.
export const MAX_BASE64_FILE_BYTES = 1 * 1024 * 1024;

export class FileUploadError extends Error {}

export type CreateFileInput = {
	filename: string;
	contentType?: string;
	slug?: string;
	expiresIn?: number;
};

export async function createFileFromBase64(
	db: Db,
	env: Env,
	accountId: string,
	input: CreateFileInput & { content: string },
	baseUrl: string,
) {
	if (!input.content) throw new FileUploadError("content (base64) required");

	let bytes: Uint8Array;
	try {
		bytes = Uint8Array.from(atob(input.content), (c) => c.charCodeAt(0));
	} catch {
		throw new FileUploadError("content must be valid base64");
	}

	return storeFile(db, env, accountId, bytes, input, baseUrl, MAX_BASE64_FILE_BYTES);
}

export async function createFileFromBytes(
	db: Db,
	env: Env,
	accountId: string,
	bytes: Uint8Array,
	input: CreateFileInput,
	baseUrl: string,
) {
	return storeFile(db, env, accountId, bytes, input, baseUrl, MAX_FILE_BYTES);
}

async function storeFile(
	db: Db,
	env: Env,
	accountId: string,
	bytes: Uint8Array,
	input: CreateFileInput,
	baseUrl: string,
	maxBytes: number,
) {
	if (!input.filename) throw new FileUploadError("filename required");
	if (input.slug && !/^[a-zA-Z0-9_-]{3,32}$/.test(input.slug)) {
		throw new FileUploadError("slug must be 3-32 chars, alphanumeric/_/- only");
	}
	if (bytes.byteLength === 0) throw new FileUploadError("file is empty");
	if (bytes.byteLength > maxBytes) {
		throw new FileUploadError(`file exceeds ${maxBytes / (1024 * 1024)}MB limit`);
	}

	const slug = input.slug ?? generateSlug();
	if (input.slug) {
		const [existing] = await db.select().from(files).where(eq(files.slug, slug)).limit(1);
		if (existing) throw new FileUploadError("slug already taken");
	}

	const r2Key = `files/${slug}`;
	await env.R2.put(r2Key, bytes, {
		httpMetadata: { contentType: input.contentType || "application/octet-stream" },
	});

	const [row] = await db
		.insert(files)
		.values({
			slug,
			accountId,
			r2Key,
			filename: input.filename,
			contentType: input.contentType || "application/octet-stream",
			sizeBytes: bytes.byteLength,
			expiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000) : undefined,
		})
		.returning();

	return { ...row, url: new URL(`/f/${row.slug}`, baseUrl).toString() };
}

export async function getActiveFile(db: Db, slug: string) {
	const [file] = await db
		.select()
		.from(files)
		.where(and(eq(files.slug, slug), or(isNull(files.expiresAt), gt(files.expiresAt, new Date()))))
		.limit(1);
	return file ?? null;
}
