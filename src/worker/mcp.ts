import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, links, pastes, inboxes, inboxMessages, files } from "../db";
import { generateSlug } from "./lib/keys";
import { normalizeHandle, InvalidHandleError } from "./lib/handle";
import { checkRateLimit } from "./lib/rate-limit";
import { sendFromInbox, SendEmailError } from "./lib/send-email";
import { emailMe, EmailMeError } from "./lib/email-me";
import { createFileFromBase64, FileUploadError } from "./lib/files";

function isValidUrl(value: string): boolean {
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

const RATE_LIMIT_ERROR = { content: [{ type: "text" as const, text: "Error: rate limit exceeded, try again shortly" }], isError: true };

function buildServer(env: Env, accountId: string, baseUrl: string) {
	const db = getDb(env.DB);
	const server = new McpServer({ name: "headlesstools", version: "1.0.0" });

	server.registerTool(
		"shorten_url",
		{
			description: "Create a short link for a URL",
			inputSchema: z.object({
				url: z.string().describe("The destination URL"),
				slug: z.string().min(3).max(32).optional().describe("Custom slug (optional)"),
				expiresIn: z.number().optional().describe("Seconds until the link expires"),
			}),
		},
		async ({ url, slug, expiresIn }) => {
			if (!(await checkRateLimit(env.CREATE_RATE_LIMITER, accountId))) return RATE_LIMIT_ERROR;
			if (!isValidUrl(url)) {
				return { content: [{ type: "text", text: "Error: valid http(s) url required" }], isError: true };
			}
			const finalSlug = slug ?? generateSlug();
			if (slug) {
				const [existing] = await db.select().from(links).where(eq(links.slug, slug)).limit(1);
				if (existing) return { content: [{ type: "text", text: "Error: slug already taken" }], isError: true };
			}
			const [link] = await db
				.insert(links)
				.values({
					slug: finalSlug,
					targetUrl: url,
					accountId,
					expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
				})
				.returning();
			const shortUrl = new URL(`/${link.slug}`, baseUrl).toString();
			return { content: [{ type: "text", text: JSON.stringify({ slug: link.slug, shortUrl, targetUrl: link.targetUrl }) }] };
		},
	);

	server.registerTool(
		"list_links",
		{ description: "List your short links", inputSchema: z.object({}) },
		async () => {
			const rows = await db.select().from(links).where(eq(links.accountId, accountId));
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		},
	);

	server.registerTool(
		"create_paste",
		{
			description: "Create a paste (text snippet) and get a shareable link",
			inputSchema: z.object({
				content: z.string().describe("The text content"),
				language: z.string().optional(),
				slug: z.string().min(3).max(32).optional(),
				visibility: z.enum(["unlisted", "private"]).optional(),
				burnAfterRead: z.boolean().optional().describe("Delete after first read"),
				expiresIn: z.number().optional().describe("Seconds until the paste expires"),
			}),
		},
		async ({ content, language, slug, visibility, burnAfterRead, expiresIn }) => {
			if (!(await checkRateLimit(env.CREATE_RATE_LIMITER, accountId))) return RATE_LIMIT_ERROR;
			const finalSlug = slug ?? generateSlug();
			if (slug) {
				const [existing] = await db.select().from(pastes).where(eq(pastes.slug, slug)).limit(1);
				if (existing) return { content: [{ type: "text", text: "Error: slug already taken" }], isError: true };
			}
			const bytes = new TextEncoder().encode(content);
			let inlineContent: string | undefined = content;
			let r2Key: string | undefined;
			const INLINE_LIMIT_BYTES = 32 * 1024;
			if (bytes.byteLength > INLINE_LIMIT_BYTES) {
				r2Key = `pastes/${finalSlug}`;
				await env.R2.put(r2Key, bytes);
				inlineContent = undefined;
			}
			const [paste] = await db
				.insert(pastes)
				.values({
					slug: finalSlug,
					accountId,
					content: inlineContent,
					r2Key,
					sizeBytes: bytes.byteLength,
					language,
					visibility: visibility ?? "unlisted",
					burnAfterRead: burnAfterRead ?? false,
					expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
				})
				.returning();
			const url = new URL(`/p/${paste.slug}`, baseUrl).toString();
			return { content: [{ type: "text", text: JSON.stringify({ slug: paste.slug, url, sizeBytes: paste.sizeBytes }) }] };
		},
	);

	server.registerTool(
		"get_paste",
		{
			description: "Fetch a paste's content by slug (works for your own private pastes too)",
			inputSchema: z.object({ slug: z.string() }),
		},
		async ({ slug }) => {
			const [paste] = await db.select().from(pastes).where(eq(pastes.slug, slug)).limit(1);
			if (!paste || (paste.expiresAt && paste.expiresAt.getTime() < Date.now())) {
				return { content: [{ type: "text", text: "Error: not found" }], isError: true };
			}
			if (paste.visibility === "private" && paste.accountId !== accountId) {
				return { content: [{ type: "text", text: "Error: not found" }], isError: true };
			}
			const content = paste.content ?? (paste.r2Key ? await (await env.R2.get(paste.r2Key))?.text() : undefined);
			if (paste.burnAfterRead) {
				if (paste.r2Key) await env.R2.delete(paste.r2Key);
				await db.delete(pastes).where(eq(pastes.id, paste.id));
			}
			return { content: [{ type: "text", text: JSON.stringify({ slug: paste.slug, content, language: paste.language }) }] };
		},
	);

	server.registerTool(
		"list_pastes",
		{ description: "List your pastes", inputSchema: z.object({}) },
		async () => {
			const rows = await db
				.select({
					slug: pastes.slug,
					language: pastes.language,
					sizeBytes: pastes.sizeBytes,
					visibility: pastes.visibility,
					createdAt: pastes.createdAt,
				})
				.from(pastes)
				.where(eq(pastes.accountId, accountId));
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		},
	);

	server.registerTool(
		"create_inbox",
		{
			description:
				"Claim your email address by picking a handle (e.g. handle=\"acme-bot\" gives you acme-bot@hdls.tools). One address per account - call list_inboxes first to check if you already have one.",
			inputSchema: z.object({
				handle: z
					.string()
					.describe("Local part of the address, 3-32 chars, lowercase letters/numbers/hyphens"),
			}),
		},
		async ({ handle: rawHandle }) => {
			if (!(await checkRateLimit(env.CREATE_RATE_LIMITER, accountId))) return RATE_LIMIT_ERROR;

			let handle: string;
			try {
				handle = normalizeHandle(rawHandle);
			} catch (err) {
				const message = err instanceof InvalidHandleError ? err.message : "invalid handle";
				return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
			}

			const [existing] = await db.select().from(inboxes).where(eq(inboxes.accountId, accountId)).limit(1);
			if (existing) {
				return {
					content: [{ type: "text", text: `Error: you already have an address: ${existing.address}` }],
					isError: true,
				};
			}

			const address = `${handle}@${env.INBOX_DOMAIN}`;

			try {
				const [inbox] = await db.insert(inboxes).values({ address, accountId }).returning();
				return { content: [{ type: "text", text: JSON.stringify(inbox) }] };
			} catch (err) {
				const taken = err instanceof Error && /UNIQUE constraint failed/.test(err.message);
				return { content: [{ type: "text", text: taken ? "Error: handle already taken" : "Error: failed to create inbox" }], isError: true };
			}
		},
	);

	server.registerTool(
		"send_email",
		{
			description: "Send an email from one of your inbox addresses. Set replyToMessageId to thread a reply to a received message.",
			inputSchema: z.object({
				inboxId: z.string(),
				to: z.union([z.string(), z.array(z.string())]).describe("Recipient address(es)"),
				subject: z.string(),
				text: z.string().optional(),
				html: z.string().optional(),
				replyToMessageId: z.string().optional().describe("id of a received message to thread this reply to"),
			}),
		},
		async ({ inboxId, to, subject, text, html, replyToMessageId }) => {
			const [inbox] = await db
				.select()
				.from(inboxes)
				.where(and(eq(inboxes.id, inboxId), eq(inboxes.accountId, accountId)))
				.limit(1);
			if (!inbox) return { content: [{ type: "text", text: "Error: not found" }], isError: true };
			if (!text && !html) {
				return { content: [{ type: "text", text: "Error: text or html required" }], isError: true };
			}
			if (!(await checkRateLimit(env.SEND_RATE_LIMITER, accountId))) return RATE_LIMIT_ERROR;

			try {
				const sent = await sendFromInbox(db, env, inbox.id, { inboxAddress: inbox.address, to, subject, text, html, replyToMessageId });
				return { content: [{ type: "text", text: JSON.stringify(sent) }] };
			} catch (err) {
				const message = err instanceof SendEmailError ? err.message : "failed to send";
				return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
			}
		},
	);

	server.registerTool(
		"list_inboxes",
		{ description: "List your email address(es). You get one address per account.", inputSchema: z.object({}) },
		async () => {
			const rows = await db.select().from(inboxes).where(eq(inboxes.accountId, accountId));
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		},
	);

	server.registerTool(
		"list_inbox_messages",
		{
			description: "List messages received in an inbox",
			inputSchema: z.object({ inboxId: z.string() }),
		},
		async ({ inboxId }) => {
			const [inbox] = await db
				.select()
				.from(inboxes)
				.where(and(eq(inboxes.id, inboxId), eq(inboxes.accountId, accountId)))
				.limit(1);
			if (!inbox) return { content: [{ type: "text", text: "Error: not found" }], isError: true };

			const messages = await db
				.select({
					id: inboxMessages.id,
					fromAddress: inboxMessages.fromAddress,
					subject: inboxMessages.subject,
					receivedAt: inboxMessages.receivedAt,
					readAt: inboxMessages.readAt,
				})
				.from(inboxMessages)
				.where(eq(inboxMessages.inboxId, inbox.id))
				.orderBy(desc(inboxMessages.receivedAt));
			return { content: [{ type: "text", text: JSON.stringify({ inbox, messages }) }] };
		},
	);

	server.registerTool(
		"get_inbox_message",
		{
			description: "Fetch the full content of a received email",
			inputSchema: z.object({ inboxId: z.string(), messageId: z.string() }),
		},
		async ({ inboxId, messageId }) => {
			const [inbox] = await db
				.select()
				.from(inboxes)
				.where(and(eq(inboxes.id, inboxId), eq(inboxes.accountId, accountId)))
				.limit(1);
			if (!inbox) return { content: [{ type: "text", text: "Error: not found" }], isError: true };

			const [message] = await db
				.select()
				.from(inboxMessages)
				.where(and(eq(inboxMessages.id, messageId), eq(inboxMessages.inboxId, inbox.id)))
				.limit(1);
			if (!message) return { content: [{ type: "text", text: "Error: not found" }], isError: true };

			if (!message.readAt) {
				await db.update(inboxMessages).set({ readAt: new Date() }).where(eq(inboxMessages.id, message.id));
			}
			return { content: [{ type: "text", text: JSON.stringify(message) }] };
		},
	);

	server.registerTool(
		"email_me",
		{
			description:
				"Email a message to the account owner's registered email, right away or at a future time. Always goes to the account's own verified email - not an arbitrary address.",
			inputSchema: z.object({
				subject: z.string(),
				text: z.string().optional(),
				html: z.string().optional(),
				at: z.string().optional().describe("ISO 8601 timestamp to send at; omit to send immediately"),
			}),
		},
		async ({ subject, text, html, at }) => {
			if (!(await checkRateLimit(env.SEND_RATE_LIMITER, accountId))) return RATE_LIMIT_ERROR;

			const atDate = at ? new Date(at) : undefined;
			if (at && (!atDate || Number.isNaN(atDate.getTime()))) {
				return { content: [{ type: "text", text: "Error: invalid 'at' timestamp" }], isError: true };
			}

			try {
				const row = await emailMe(db, env, accountId, { subject, text, html, at: atDate });
				return { content: [{ type: "text", text: JSON.stringify(row) }] };
			} catch (err) {
				const message = err instanceof EmailMeError ? err.message : "failed to email";
				return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
			}
		},
	);

	server.registerTool(
		"create_file",
		{
			description: "Upload a file (base64-encoded content) and get back a public, directly-linkable URL. Max 1MB.",
			inputSchema: z.object({
				content: z.string().describe("Base64-encoded file content"),
				filename: z.string(),
				contentType: z.string().optional().describe("MIME type, e.g. image/png"),
				slug: z.string().min(3).max(32).optional(),
				expiresIn: z.number().optional().describe("Seconds until the file expires"),
			}),
		},
		async ({ content, filename, contentType, slug, expiresIn }) => {
			if (!(await checkRateLimit(env.CREATE_RATE_LIMITER, accountId))) return RATE_LIMIT_ERROR;
			try {
				const file = await createFileFromBase64(db, env, accountId, { content, filename, contentType, slug, expiresIn }, baseUrl);
				return { content: [{ type: "text", text: JSON.stringify(file) }] };
			} catch (err) {
				const message = err instanceof FileUploadError ? err.message : "failed to upload";
				return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
			}
		},
	);

	server.registerTool(
		"list_files",
		{ description: "List your uploaded files", inputSchema: z.object({}) },
		async () => {
			const rows = await db
				.select({
					slug: files.slug,
					filename: files.filename,
					contentType: files.contentType,
					sizeBytes: files.sizeBytes,
					createdAt: files.createdAt,
				})
				.from(files)
				.where(eq(files.accountId, accountId));
			return { content: [{ type: "text", text: JSON.stringify(rows) }] };
		},
	);

	server.registerTool(
		"delete_file",
		{ description: "Delete an uploaded file", inputSchema: z.object({ slug: z.string() }) },
		async ({ slug }) => {
			const [file] = await db.select().from(files).where(and(eq(files.slug, slug), eq(files.accountId, accountId))).limit(1);
			if (!file) return { content: [{ type: "text", text: "Error: not found" }], isError: true };
			await env.R2.delete(file.r2Key);
			await db.delete(files).where(eq(files.id, file.id));
			return { content: [{ type: "text", text: "ok" }] };
		},
	);

	return server;
}

export type McpAuthProps = { accountId: string; email: string };

// Matches whatever ExecutionContext shape agents/mcp/server's handler expects
// at this dependency version, avoiding a cross-package @cloudflare/workers-types
// version mismatch with our own generated ambient ExecutionContext type.
type McpExecutionContext = Parameters<ReturnType<typeof createMcpHandler>>[2];

// Auth is handled upstream by OAuthProvider (see oauth.ts), which validates
// the bearer token (OAuth-issued or a legacy static API key, via
// resolveExternalToken) and injects the account identity into ctx.props
// before this handler ever runs.
export const mcpApiHandler = {
	async fetch(request: Request, env: Env, ctx: McpExecutionContext): Promise<Response> {
		const props = (ctx as { props?: McpAuthProps }).props;
		if (!props?.accountId) {
			return new Response(JSON.stringify({ error: "unauthenticated" }), {
				status: 401,
				headers: { "content-type": "application/json" },
			});
		}

		const baseUrl = new URL(request.url).origin;
		const handler = createMcpHandler(() => buildServer(env, props.accountId, baseUrl));
		return handler(request, env, ctx);
	},
};
