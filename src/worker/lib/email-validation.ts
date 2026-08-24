const MAX_RECIPIENTS = 50;
const MAX_SUBJECT_CHARS = 998;
export const MAX_EMAIL_CONTENT_BYTES = 256 * 1024;

export class InvalidEmailError extends Error {}

function isValidAddress(value: string): boolean {
	return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateOutboundEmail(input: {
	to: string | string[];
	subject: string;
	text?: string;
	html?: string;
}) {
	const recipients = Array.isArray(input.to) ? input.to : [input.to];
	if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS || recipients.some((address) => typeof address !== "string" || !isValidAddress(address.trim()))) {
		throw new InvalidEmailError(`to must contain 1-${MAX_RECIPIENTS} valid email addresses`);
	}
	if (!input.subject || input.subject.length > MAX_SUBJECT_CHARS || /[\r\n]/.test(input.subject)) {
		throw new InvalidEmailError(`subject must be 1-${MAX_SUBJECT_CHARS} characters without line breaks`);
	}
	if (!input.text && !input.html) throw new InvalidEmailError("text or html required");
	const contentBytes = new TextEncoder().encode((input.text ?? "") + (input.html ?? "")).byteLength;
	if (contentBytes > MAX_EMAIL_CONTENT_BYTES) {
		throw new InvalidEmailError(`email content exceeds ${MAX_EMAIL_CONTENT_BYTES / (1024 * 1024)}MB limit`);
	}
	return { ...input, to: recipients.map((address) => address.trim()) };
}
