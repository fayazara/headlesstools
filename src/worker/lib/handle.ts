const RESERVED_HANDLES = new Set([
	"admin",
	"administrator",
	"root",
	"support",
	"help",
	"postmaster",
	"hostmaster",
	"webmaster",
	"abuse",
	"security",
	"noreply",
	"no-reply",
	"info",
	"contact",
	"sales",
	"billing",
	"staff",
	"moderator",
	"system",
	"api",
	"mail",
	"email",
	"ftp",
	"www",
	"test",
	"null",
	"undefined",
	"hlt",
	"headlesstools",
]);

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

export class InvalidHandleError extends Error {}

export function normalizeHandle(raw: string): string {
	const handle = raw.trim().toLowerCase();

	if (!HANDLE_RE.test(handle)) {
		throw new InvalidHandleError(
			"handle must be 3-32 chars, lowercase letters/numbers/hyphens, and can't start or end with a hyphen",
		);
	}
	if (RESERVED_HANDLES.has(handle)) {
		throw new InvalidHandleError("handle is reserved");
	}

	return handle;
}
