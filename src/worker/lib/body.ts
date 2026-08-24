export class InvalidBodyError extends Error {}
export class PayloadTooLargeError extends Error {}

export function assertDeclaredBodyWithinLimit(request: Request, maxBytes: number) {
	const declaredLength = request.headers.get("content-length");
	if (declaredLength !== null) {
		const length = Number(declaredLength);
		if (!Number.isFinite(length) || length < 0) throw new InvalidBodyError("invalid content-length");
		if (length > maxBytes) throw new PayloadTooLargeError(`request body exceeds ${maxBytes} bytes`);
	}
}

export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
	assertDeclaredBodyWithinLimit(request, maxBytes);

	if (!request.body) return new Uint8Array();

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel("body too large");
				throw new PayloadTooLargeError(`request body exceeds ${maxBytes} bytes`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

export async function readJsonWithLimit<T>(request: Request, maxBytes: number): Promise<T> {
	const bytes = await readBodyWithLimit(request, maxBytes);
	if (bytes.byteLength === 0) throw new InvalidBodyError("request body required");
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as T;
	} catch {
		throw new InvalidBodyError("invalid JSON body");
	}
}

export async function readUrlEncodedFormWithLimit(request: Request, maxBytes: number): Promise<URLSearchParams> {
	const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
	if (contentType !== "application/x-www-form-urlencoded") {
		throw new InvalidBodyError("form must use application/x-www-form-urlencoded");
	}
	const bytes = await readBodyWithLimit(request, maxBytes);
	if (bytes.byteLength === 0) throw new InvalidBodyError("request body required");
	return new URLSearchParams(new TextDecoder().decode(bytes));
}
