import PostalMime from "postal-mime";
import { and, eq, or, isNull, gt } from "drizzle-orm";
import { getDb, inboxes, inboxMessages } from "../db";
import { assertInboundEmailQuota, QuotaExceededError } from "./lib/quotas";

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

	if (!inbox) {
		message.setReject("Address not found");
		console.log(JSON.stringify({ message: "inbound email rejected", reason: "address_not_found" }));
		return;
	}
	try {
		await assertInboundEmailQuota(db, inbox.id, message.rawSize);
	} catch (error) {
		if (error instanceof QuotaExceededError) {
			message.setReject(error.message);
			console.log(JSON.stringify({ message: "inbound email rejected", reason: "quota" }));
			return;
		}
		throw error;
	}

	// rawSize is checked against the application quota before this bounded read.
	const rawBuffer = await new Response(message.raw).arrayBuffer();

	const parsed = await PostalMime.parse(rawBuffer);
	const rowId = crypto.randomUUID();
	const rawR2Key = `inbox-raw/${inbox.id}/${rowId}`;

	await env.R2.put(rawR2Key, rawBuffer, { onlyIf: { etagDoesNotMatch: "*" } });
	try {
		await db.insert(inboxMessages).values({
			id: rowId,
			inboxId: inbox.id,
			direction: "inbound",
			fromAddress: message.from,
			toAddress: to,
			subject: parsed.subject ?? "(no subject)",
			textBody: parsed.text,
			htmlBody: parsed.html,
			rawR2Key,
			messageId: parsed.messageId,
			inReplyTo: parsed.inReplyTo,
			sizeBytes: rawBuffer.byteLength,
			deliveryStatus: "sent",
		});
	} catch (error) {
		await env.R2.delete(rawR2Key);
		throw error;
	}
}
