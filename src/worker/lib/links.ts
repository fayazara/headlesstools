import { links, type Db } from "../../db";
import { generateSlug, InvalidSlugError, validateCustomSlug } from "./keys";
import { assertLinkQuota, QuotaExceededError } from "./quotas";
import { isUniqueConstraintError, normalizeExpiresIn, ValidationError } from "./validation";

export class LinkError extends Error {}

export type CreateLinkInput = { url: string; slug?: string; expiresIn?: number };

export function isValidHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export async function createLink(db: Db, accountId: string, input: CreateLinkInput) {
	const targetUrl = input.url.trim();
	if (!isValidHttpUrl(targetUrl)) throw new LinkError("valid http(s) url required");
	let customSlug: string | undefined;
	let expiresIn: number | undefined;
	try {
		customSlug = validateCustomSlug(input.slug, { root: true });
		expiresIn = normalizeExpiresIn(input.expiresIn);
	} catch (error) {
		if (error instanceof InvalidSlugError || error instanceof ValidationError) throw new LinkError(error.message);
		throw error;
	}

	await assertLinkQuota(db, accountId).catch((error) => {
		if (error instanceof QuotaExceededError) throw new LinkError(error.message);
		throw error;
	});

	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const [link] = await db
				.insert(links)
				.values({
					slug: customSlug ?? generateSlug(),
					targetUrl,
					accountId,
					expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
				})
				.returning();
			return link;
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				if (customSlug) throw new LinkError("slug already taken");
				continue;
			}
			throw error;
		}
	}

	throw new LinkError("could not allocate a unique short URL");
}
