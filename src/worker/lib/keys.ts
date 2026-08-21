const KEY_PREFIX = "hlt_live_";

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

export function generateLoginCode(): string {
	const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	return n.toString().padStart(6, "0");
}

export async function hashLoginCode(code: string): Promise<string> {
	return sha256Hex(code);
}

export function generateSlug(bytes = 5): string {
	// base32-ish, unambiguous alphabet (no 0/O/1/I/L)
	const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
	const arr = crypto.getRandomValues(new Uint8Array(bytes));
	return Array.from(arr, (b) => alphabet[b % alphabet.length]).join("");
}

export function generateInboxLocalPart(): string {
	return generateSlug(8);
}
