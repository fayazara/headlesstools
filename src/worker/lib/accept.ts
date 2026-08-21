// minimal RFC 9110 §12.5.1 quality-value negotiation, just enough to decide
// between text/markdown and text/html for the landing page response
export function prefersMarkdown(acceptHeader: string | undefined | null): boolean {
	if (!acceptHeader) return false;

	const types = acceptHeader.split(",").map((part) => {
		const [type, ...params] = part.trim().split(";");
		const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
		const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
		return { type: type.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
	});

	const markdown = types.find((t) => t.type === "text/markdown");
	if (!markdown) return false;

	const competing = types.find((t) => t.type === "text/html" || t.type === "*/*");
	return !competing || markdown.q >= competing.q;
}
