import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, links, pastes, inboxes, inboxMessages } from "../db";
import { generateSlug, generateInboxLocalPart } from "./lib/keys";
import { checkRateLimit } from "./lib/rate-limit";

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
			description: "Create a disposable email inbox and get its address",
			inputSchema: z.object({ expiresIn: z.number().optional().describe("Seconds until the inbox expires") }),
		},
		async ({ expiresIn }) => {
			if (!(await checkRateLimit(env.CREATE_RATE_LIMITER, accountId))) return RATE_LIMIT_ERROR;
			const address = `${generateInboxLocalPart()}@${env.INBOX_DOMAIN}`;
			const [inbox] = await db
				.insert(inboxes)
				.values({
					address,
					accountId,
					expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
				})
				.returning();
			return { content: [{ type: "text", text: JSON.stringify(inbox) }] };
		},
	);

	server.registerTool(
		"list_inboxes",
		{ description: "List your inboxes", inputSchema: z.object({}) },
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
