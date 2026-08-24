const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

export class ValidationError extends Error {}

export function hasControlCharacters(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

export function isUniqueConstraintError(error: unknown): boolean {
	const seen = new Set<unknown>();
	let current = error;
	while (current && !seen.has(current)) {
		seen.add(current);
		if (current instanceof Error && /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/.test(current.message)) {
			return true;
		}
		current = typeof current === "object" && "cause" in current ? current.cause : undefined;
	}
	return false;
}

export function normalizeEmail(value: unknown): string {
	const email = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new ValidationError("valid email required");
	}
	return email;
}

export function normalizeExpiresIn(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		throw new ValidationError("expiresIn must be a positive whole number of seconds");
	}
	if (value > MAX_EXPIRY_SECONDS) {
		throw new ValidationError("expiresIn cannot exceed 365 days");
	}
	return value;
}

export function normalizeIdempotencyKey(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new ValidationError("idempotency key must be a string");
	const key = value.trim();
	if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
		throw new ValidationError("idempotency key must be 8-128 URL-safe characters");
	}
	return key;
}
