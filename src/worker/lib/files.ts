import { and, eq, isNull, or, gt } from "drizzle-orm";
import { files, type Db } from "../../db";
import { generateSlug } from "./keys";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class FileUploadError extends Error {}

export type CreateFileInput = {
	content: string; // base64
	filename: string;
	contentType?: string;
	slug?: string;
	expiresIn?: number;
};

export async function createFile(db: Db, env: Env, accountId: string, input: CreateFileInput, baseUrl: string) {
	if (!input.content) throw new FileUploadError("content (base64) required");
	if (!input.filename) throw new FileUploadError("filename required");
	if (input.slug && !/^[a-zA-Z0-9_-]{3,32}$/.test(input.slug)) {
		throw new FileUploadError("slug must be 3-32 chars, alphanumeric/_/- only");
	}

	let bytes: Uint8Array;
	try {
		bytes = Uint8Array.from(atob(input.content), (c) => c.charCodeAt(0));
	} catch {
		throw new FileUploadError("content must be valid base64");
	}
	if (bytes.byteLength > MAX_FILE_BYTES) {
		throw new FileUploadError(`file exceeds ${MAX_FILE_BYTES / (1024 * 1024)}MB limit`);
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
