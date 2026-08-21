import PostalMime from "postal-mime";
import { and, eq, or, isNull, gt } from "drizzle-orm";
import { getDb, inboxes, inboxMessages } from "../db";

export async function handleEmail(message: ForwardableEmailMessage, env: Env) {
	const db = getDb(env.DB);
	const to = message.to.toLowerCase();

	const [inbox] = await db
		.select()
		.from(inboxes)
		.where(
			and(
				eq(inboxes.address, to),
				or(isNull(inboxes.expiresAt), gt(inboxes.expiresAt, new Date())),
			),
		)
		.limit(1);

	// Buffer raw regardless, so the handler always "acts" on the message
	// (Cloudflare drops silently otherwise) and to avoid a dangling stream.
	const rawBuffer = await new Response(message.raw).arrayBuffer();

	if (!inbox) {
		console.log(`headlesstools: no inbox for ${to}, dropping`);
		return;
	}

	const parsed = await PostalMime.parse(rawBuffer);
	const messageId = crypto.randomUUID();
	const rawR2Key = `inbox-raw/${inbox.id}/${messageId}`;

	await env.R2.put(rawR2Key, rawBuffer);

	await db.insert(inboxMessages).values({
		id: messageId,
		inboxId: inbox.id,
		fromAddress: message.from,
		toAddress: to,
		subject: parsed.subject ?? "(no subject)",
		textBody: parsed.text,
		htmlBody: parsed.html,
		rawR2Key,
	});
}
