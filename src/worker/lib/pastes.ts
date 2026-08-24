import { eq } from "drizzle-orm";
import { pastes, type Db } from "../../db";
import { accountIdForApiKey } from "./account";
import { generateSlug, InvalidSlugError, validateCustomSlug } from "./keys";
import { assertPasteQuota, QuotaExceededError } from "./quotas";
import { hasControlCharacters, isUniqueConstraintError, normalizeExpiresIn, ValidationError } from "./validation";

const INLINE_LIMIT_BYTES = 32 * 1024;

export class PasteError extends Error {}

export type CreatePasteInput = {
	content: string;
	language?: string;
	slug?: string;
	visibility?: "unlisted" | "private";
	burnAfterRead?: boolean;
	expiresIn?: number;
};

export type ResolvedPaste = {
	paste: typeof pastes.$inferSelect;
	content: string | undefined;
};

export async function createPaste(db: Db, env: Env, accountId: string, input: CreatePasteInput) {
	if (!input.content) throw new PasteError("content required");
	const language = input.language?.trim();
	if (language && (language.length > 64 || hasControlCharacters(language))) {
		throw new PasteError("language must be at most 64 characters without control characters");
	}
	let customSlug: string | undefined;
	let expiresIn: number | undefined;
	try {
		customSlug = validateCustomSlug(input.slug);
		expiresIn = normalizeExpiresIn(input.expiresIn);
	} catch (error) {
		if (error instanceof InvalidSlugError || error instanceof ValidationError) throw new PasteError(error.message);
		throw error;
	}

	const bytes = new TextEncoder().encode(input.content);
	await assertPasteQuota(db, accountId, bytes.byteLength).catch((error) => {
		if (error instanceof QuotaExceededError) throw new PasteError(error.message);
		throw error;
	});

	for (let attempt = 0; attempt < 4; attempt++) {
		const slug = customSlug ?? generateSlug();
		const r2Key = bytes.byteLength > INLINE_LIMIT_BYTES ? `pastes/${slug}` : undefined;
		let paste: typeof pastes.$inferSelect;
		try {
			[paste] = await db
				.insert(pastes)
				.values({
					slug,
					accountId,
					content: r2Key ? undefined : input.content,
					r2Key,
					sizeBytes: bytes.byteLength,
					language,
					visibility: input.visibility ?? "unlisted",
					burnAfterRead: input.burnAfterRead ?? false,
					expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
				})
				.returning();
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				if (customSlug) throw new PasteError("slug already taken");
				continue;
			}
			throw error;
		}

		if (!r2Key) return paste;
		try {
			const object = await env.R2.put(r2Key, bytes, { onlyIf: { etagDoesNotMatch: "*" } });
			if (!object) throw new PasteError("paste key already exists");
			return paste;
		} catch (error) {
			await db.delete(pastes).where(eq(pastes.id, paste.id));
			if (error instanceof PasteError && !customSlug) continue;
			throw error;
		}
	}

	throw new PasteError("could not allocate a unique paste URL");
}

export async function resolvePaste(
	db: Db,
	env: Env,
	slug: string,
	authHeader: string | null,
	authenticatedAccountId?: string,
): Promise<ResolvedPaste | "not_found"> {
	const [found] = await db.select().from(pastes).where(eq(pastes.slug, slug)).limit(1);
	if (!found) return "not_found";
	if (found.expiresAt && found.expiresAt.getTime() < Date.now()) return "not_found";

	if (found.visibility === "private") {
		const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
		const ownerId = authenticatedAccountId ?? (token ? await accountIdForApiKey(db, token) : null);
		if (!token || found.accountId !== ownerId) return "not_found";
	}

	let paste = found;
	if (found.burnAfterRead) {
		const [claimed] = await db.delete(pastes).where(eq(pastes.id, found.id)).returning();
		if (!claimed) return "not_found";
		paste = claimed;
	}

	const content = paste.content ?? (paste.r2Key ? await (await env.R2.get(paste.r2Key))?.text() : undefined);
	if (paste.burnAfterRead && paste.r2Key) await env.R2.delete(paste.r2Key);

	return { paste, content };
}
