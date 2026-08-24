import { and, eq, isNull, or, gt } from "drizzle-orm";
import { files, type Db } from "../../db";
import { generateSlug, generateUploadToken } from "./keys";

// Every upload is raw bytes, no base64 anywhere — this is the only cap.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const UPLOAD_TOKEN_TTL_SECONDS = 600; // 10 minutes
const uploadKvKey = (token: string) => `upload:${token}`;

export class FileUploadError extends Error {}

export type CreateFileInput = {
	filename: string;
	contentType?: string;
	slug?: string;
	expiresIn?: number;
};

// Step 1 of the token-based flow (used by MCP and the metadata-only REST call):
// mint a short-lived, single-use token for this account. No file bytes yet.
export async function createUploadToken(env: Env, accountId: string, input: CreateFileInput) {
	if (!input.filename) throw new FileUploadError("filename required");
	if (input.slug && !/^[a-zA-Z0-9_-]{3,32}$/.test(input.slug)) {
		throw new FileUploadError("slug must be 3-32 chars, alphanumeric/_/- only");
	}

	const token = generateUploadToken();
	const pending: CreateFileInput & { accountId: string } = { accountId, ...input };
	await env.OAUTH_KV.put(uploadKvKey(token), JSON.stringify(pending), { expirationTtl: UPLOAD_TOKEN_TTL_SECONDS });

	return { token, expiresAt: new Date(Date.now() + UPLOAD_TOKEN_TTL_SECONDS * 1000) };
}

// Step 2: whoever holds the token PUTs the raw file body — no auth header
// needed, the token itself is the one-time credential.
export async function finalizeUpload(db: Db, env: Env, token: string, bytes: Uint8Array, baseUrl: string) {
	const key = uploadKvKey(token);
	const raw = await env.OAUTH_KV.get(key);
	if (!raw) throw new FileUploadError("upload token invalid or expired");
	await env.OAUTH_KV.delete(key);

	const pending = JSON.parse(raw) as CreateFileInput & { accountId: string };
	return storeFile(db, env, pending.accountId, bytes, pending, baseUrl);
}

// Direct one-shot raw upload for REST clients that already hold an API key
// (PUT /v1/files with the file as the request body).
export async function createFileFromBytes(
	db: Db,
	env: Env,
	accountId: string,
	bytes: Uint8Array,
	input: CreateFileInput,
	baseUrl: string,
) {
	return storeFile(db, env, accountId, bytes, input, baseUrl);
}

async function storeFile(db: Db, env: Env, accountId: string, bytes: Uint8Array, input: CreateFileInput, baseUrl: string) {
	if (!input.filename) throw new FileUploadError("filename required");
	if (input.slug && !/^[a-zA-Z0-9_-]{3,32}$/.test(input.slug)) {
		throw new FileUploadError("slug must be 3-32 chars, alphanumeric/_/- only");
	}
	if (bytes.byteLength === 0) throw new FileUploadError("file is empty");
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
