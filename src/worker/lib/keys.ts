const KEY_PREFIX = "hlt_live_";
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CUSTOM_SLUG_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const RESERVED_ROOT_SLUGS = new Set(["authorize", "mcp", "oauth", "v1", "p", "f"]);

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function randomToken(bytes: number): string {
	const arr = crypto.getRandomValues(new Uint8Array(bytes));
	return Array.from(arr)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function generateApiKey() {
	const secret = randomToken(24);
	const key = `${KEY_PREFIX}${secret}`;
	const keyHash = await sha256Hex(key);
	const keyPrefix = key.slice(0, KEY_PREFIX.length + 6);
	return { key, keyHash, keyPrefix };
}

export async function hashApiKey(key: string): Promise<string> {
	return sha256Hex(key);
}

export async function hashOpaqueToken(token: string): Promise<string> {
	return sha256Hex(token);
}

export function generateLoginCode(): string {
	const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	return n.toString().padStart(6, "0");
}

export async function hashLoginCode(code: string): Promise<string> {
	return sha256Hex(code);
}

export function generateUploadToken(): string {
	return randomToken(24);
}

export function generateSlug(length = 26): string {
	// 31^26 is slightly above 128 bits. Rejection sampling removes modulo bias.
	let slug = "";
	const unbiasedCeiling = Math.floor(256 / SLUG_ALPHABET.length) * SLUG_ALPHABET.length;
	while (slug.length < length) {
		const bytes = crypto.getRandomValues(new Uint8Array(length - slug.length));
		for (const byte of bytes) {
			if (byte >= unbiasedCeiling) continue;
			slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
			if (slug.length === length) break;
		}
	}
	return slug;
}

export class InvalidSlugError extends Error {}

export function validateCustomSlug(slug: string | undefined, options?: { root?: boolean }): string | undefined {
	if (!slug) return undefined;
	if (!CUSTOM_SLUG_RE.test(slug)) {
		throw new InvalidSlugError("slug must be 3-32 chars, alphanumeric/_/- only");
	}
	if (options?.root && RESERVED_ROOT_SLUGS.has(slug.toLowerCase())) {
		throw new InvalidSlugError("slug is reserved");
	}
	return slug;
}
