import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { getDb, inboxes, inboxMessages } from "../../db";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { requireCreateRateLimit } from "../middleware/rate-limit";
import { normalizeHandle, InvalidHandleError } from "../lib/handle";
import { checkRateLimit } from "../lib/rate-limit";
import { sendFromInbox, SendEmailError } from "../lib/send-email";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/", requireAuth, requireCreateRateLimit, async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const rawHandle = typeof body?.handle === "string" ? body.handle : "";

	if (!rawHandle) {
		return c.json({ error: "handle required" }, 400);
	}

	let handle: string;
	try {
		handle = normalizeHandle(rawHandle);
	} catch (err) {
		if (err instanceof InvalidHandleError) return c.json({ error: err.message }, 400);
		throw err;
	}

	const db = getDb(c.env.DB);
	const accountId = c.get("accountId");

	const [existing] = await db.select().from(inboxes).where(eq(inboxes.accountId, accountId)).limit(1);
	if (existing) {
		return c.json({ error: "you already have an address", inbox: existing }, 409);
	}

	const address = `${handle}@${c.env.INBOX_DOMAIN}`;

	const [addressTaken] = await db.select().from(inboxes).where(eq(inboxes.address, address)).limit(1);
	if (addressTaken) {
		return c.json({ error: "handle already taken" }, 409);
	}

	try {
		const [inbox] = await db
			.insert(inboxes)
			.values({
				address,
				accountId,
			})
			.returning();

		return c.json(inbox, 201);
	} catch (err) {
		if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
			return c.json({ error: "handle already taken" }, 409);
		}
		throw err;
	}
});

app.get("/", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const rows = await db.select().from(inboxes).where(eq(inboxes.accountId, c.get("accountId")));
	return c.json({ inboxes: rows });
});

app.get("/:id", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const [inbox] = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, c.req.param("id")), eq(inboxes.accountId, c.get("accountId"))))
		.limit(1);

	if (!inbox) return c.json({ error: "not found" }, 404);

	const messages = await db
		.select({
			id: inboxMessages.id,
			direction: inboxMessages.direction,
			fromAddress: inboxMessages.fromAddress,
			toAddress: inboxMessages.toAddress,
			subject: inboxMessages.subject,
			receivedAt: inboxMessages.receivedAt,
			readAt: inboxMessages.readAt,
		})
		.from(inboxMessages)
		.where(eq(inboxMessages.inboxId, inbox.id))
		.orderBy(desc(inboxMessages.receivedAt));

	return c.json({ ...inbox, messages });
});

app.post("/:id/send", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const [inbox] = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, c.req.param("id")), eq(inboxes.accountId, c.get("accountId"))))
		.limit(1);
	if (!inbox) return c.json({ error: "not found" }, 404);

	if (!(await checkRateLimit(c.env.SEND_RATE_LIMITER, c.get("accountId")))) {
		return c.json({ error: "rate limit exceeded, try again shortly" }, 429);
	}

	const body = await c.req.json().catch(() => null);
	const to = body?.to;
	const subject = typeof body?.subject === "string" ? body.subject : "";
	const text = typeof body?.text === "string" ? body.text : undefined;
	const html = typeof body?.html === "string" ? body.html : undefined;
	const replyToMessageId = typeof body?.replyToMessageId === "string" ? body.replyToMessageId : undefined;

	if (!to || (typeof to !== "string" && !Array.isArray(to)) || !subject || (!text && !html)) {
		return c.json({ error: "to, subject, and text or html are required" }, 400);
	}

	try {
		const sent = await sendFromInbox(db, c.env, inbox.id, { inboxAddress: inbox.address, to, subject, text, html, replyToMessageId });
		return c.json(sent, 201);
	} catch (err) {
		if (err instanceof SendEmailError) return c.json({ error: err.message }, 400);
		throw err;
	}
});

app.get("/:id/messages/:messageId", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const [inbox] = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, c.req.param("id")), eq(inboxes.accountId, c.get("accountId"))))
		.limit(1);
	if (!inbox) return c.json({ error: "not found" }, 404);

	const [message] = await db
		.select()
		.from(inboxMessages)
		.where(and(eq(inboxMessages.id, c.req.param("messageId")), eq(inboxMessages.inboxId, inbox.id)))
		.limit(1);
	if (!message) return c.json({ error: "not found" }, 404);

	if (!message.readAt) {
		c.executionCtx.waitUntil(
			db.update(inboxMessages).set({ readAt: new Date() }).where(eq(inboxMessages.id, message.id)).run(),
		);
	}

	return c.json(message);
});

app.delete("/:id", requireAuth, async (c) => {
	const db = getDb(c.env.DB);
	const [inbox] = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, c.req.param("id")), eq(inboxes.accountId, c.get("accountId"))))
		.limit(1);
	if (!inbox) return c.json({ error: "not found" }, 404);

	const messages = await db
		.select({ id: inboxMessages.id, rawR2Key: inboxMessages.rawR2Key })
		.from(inboxMessages)
		.where(eq(inboxMessages.inboxId, inbox.id));

	await Promise.all(messages.filter((m) => m.rawR2Key).map((m) => c.env.R2.delete(m.rawR2Key!)));
	await db.delete(inboxMessages).where(eq(inboxMessages.inboxId, inbox.id));
	await db.delete(inboxes).where(eq(inboxes.id, inbox.id));

	return c.json({ ok: true });
});

export default app;
