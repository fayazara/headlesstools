import { and, eq, gt, isNull, or } from "drizzle-orm";
import { files, pendingUploads, type Db } from "../../db";
import { generateSlug, generateUploadToken, hashOpaqueToken, InvalidSlugError, validateCustomSlug } from "./keys";
import { assertFileQuota, QuotaExceededError } from "./quotas";
import { hasControlCharacters, isUniqueConstraintError, normalizeExpiresIn, ValidationError } from "./validation";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_TTL_SECONDS = 12 * 60 * 60;
const UPLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_FILENAME_CHARS = 255;
const MAX_CONTENT_TYPE_CHARS = 255;

export class FileUploadError extends Error {}

export type CreateFileInput = {
	filename: string;
	contentType?: string;
	slug?: string;
	expiresIn?: number;
};

type ValidatedFileInput = {
	filename: string;
	contentType: string;
	slug?: string;
	expiresAt: Date;
};

function validateFileInput(input: CreateFileInput): ValidatedFileInput {
	const filename = input.filename.trim();
	if (!filename) throw new FileUploadError("filename required");
	if (filename.length > MAX_FILENAME_CHARS || hasControlCharacters(filename)) {
		throw new FileUploadError(`filename must be at most ${MAX_FILENAME_CHARS} characters without control characters`);
	}

	const contentType = (input.contentType || "application/octet-stream").trim().toLowerCase();
	if (!contentType || contentType.length > MAX_CONTENT_TYPE_CHARS || hasControlCharacters(contentType)) {
		throw new FileUploadError("invalid content type");
	}

	try {
		const slug = validateCustomSlug(input.slug);
		const expiresIn = normalizeExpiresIn(input.expiresIn);
		// Files are always temporary: 12h is a hard ceiling regardless of what's
		// requested, not just a default, so we never end up hosting long-lived files.
		const ttlSeconds = Math.min(expiresIn ?? MAX_FILE_TTL_SECONDS, MAX_FILE_TTL_SECONDS);
		return {
			filename,
			contentType,
			slug,
			expiresAt: new Date(Date.now() + ttlSeconds * 1000),
		};
	} catch (error) {
		if (error instanceof InvalidSlugError || error instanceof ValidationError) {
			throw new FileUploadError(error.message);
		}
		throw error;
	}
}

export async function createUploadToken(db: Db, accountId: string, input: CreateFileInput) {
	const validated = validateFileInput(input);
	await assertFileQuota(db, accountId).catch((error) => {
		if (error instanceof QuotaExceededError) throw new FileUploadError(error.message);
		throw error;
	});

	const token = generateUploadToken();
	const tokenHash = await hashOpaqueToken(token);
	const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_MS);
	await db.insert(pendingUploads).values({
		tokenHash,
		accountId,
		filename: validated.filename,
		contentType: validated.contentType,
		slug: validated.slug,
		fileExpiresAt: validated.expiresAt,
		expiresAt,
	});
	return { token, expiresAt };
}

export async function claimUploadToken(db: Db, token: string): Promise<(ValidatedFileInput & { accountId: string }) | null> {
	const tokenHash = await hashOpaqueToken(token);
	const [claimed] = await db
		.delete(pendingUploads)
		.where(and(eq(pendingUploads.tokenHash, tokenHash), gt(pendingUploads.expiresAt, new Date())))
		.returning();
	if (!claimed) return null;
	return {
		accountId: claimed.accountId,
		filename: claimed.filename,
		contentType: claimed.contentType,
		slug: claimed.slug ?? undefined,
		expiresAt: claimed.fileExpiresAt ?? new Date(Date.now() + MAX_FILE_TTL_SECONDS * 1000),
	};
}

export async function createFileFromBytes(
	db: Db,
	env: Env,
	accountId: string,
	bytes: Uint8Array,
	input: CreateFileInput,
	baseUrl: string,
) {
	return storeFile(db, env, accountId, bytes, validateFileInput(input), baseUrl);
}

export async function finalizeClaimedUpload(
	db: Db,
	env: Env,
	claimed: ValidatedFileInput & { accountId: string },
	bytes: Uint8Array,
	baseUrl: string,
) {
	return storeFile(db, env, claimed.accountId, bytes, claimed, baseUrl);
}

async function storeFile(
	db: Db,
	env: Env,
	accountId: string,
	bytes: Uint8Array,
	input: ValidatedFileInput,
	baseUrl: string,
) {
	if (bytes.byteLength === 0) throw new FileUploadError("file is empty");
	if (bytes.byteLength > MAX_FILE_BYTES) {
		throw new FileUploadError(`file exceeds ${MAX_FILE_BYTES / (1024 * 1024)}MB limit`);
	}
	await assertFileQuota(db, accountId, bytes.byteLength).catch((error) => {
		if (error instanceof QuotaExceededError) throw new FileUploadError(error.message);
		throw error;
	});

	for (let attempt = 0; attempt < 4; attempt++) {
		const slug = input.slug ?? generateSlug();
		const r2Key = `files/${slug}`;
		let row: typeof files.$inferSelect;
		try {
			[row] = await db
				.insert(files)
				.values({
					slug,
					accountId,
					r2Key,
					filename: input.filename,
					contentType: input.contentType,
					sizeBytes: bytes.byteLength,
					expiresAt: input.expiresAt,
				})
				.returning();
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				if (input.slug) throw new FileUploadError("slug already taken");
				continue;
			}
			throw error;
		}

		try {
			const object = await env.R2.put(r2Key, bytes, {
				httpMetadata: { contentType: input.contentType },
				onlyIf: { etagDoesNotMatch: "*" },
			});
			if (!object) throw new FileUploadError("file key already exists");
			return { ...row, url: new URL(`/f/${row.slug}`, baseUrl).toString() };
		} catch (error) {
			await db.delete(files).where(eq(files.id, row.id));
			if (error instanceof FileUploadError && !input.slug) continue;
			throw error;
		}
	}

	throw new FileUploadError("could not allocate a unique file URL");
}

export async function getActiveFile(db: Db, slug: string) {
	const [file] = await db
		.select()
		.from(files)
		.where(and(eq(files.slug, slug), or(isNull(files.expiresAt), gt(files.expiresAt, new Date()))))
		.limit(1);
	return file ?? null;
}
