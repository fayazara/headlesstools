import { and, eq, or, sql } from "drizzle-orm";
import { inboxMessages, type Db } from "../../db";
import { InvalidEmailError, validateOutboundEmail } from "./email-validation";
import { assertOutboundEmailQuota, QuotaExceededError } from "./quotas";
import { isUniqueConstraintError } from "./validation";

export type SendEmailInput = {
	inboxAddress: string;
	to: string | string[];
	subject: string;
	text?: string;
	html?: string;
	replyToMessageId?: string;
	idempotencyKey?: string;
};

export class SendEmailError extends Error {}

function asMessageIdHeader(value: string): string {
	return value.startsWith("<") ? value : `<${value}>`;
}

export async function sendFromInbox(db: Db, env: Env, accountId: string, inboxId: string, input: SendEmailInput) {
	let validated: ReturnType<typeof validateOutboundEmail>;
	try {
		validated = validateOutboundEmail(input);
		await assertOutboundEmailQuota(db, accountId);
	} catch (error) {
		if (error instanceof InvalidEmailError || error instanceof QuotaExceededError) throw new SendEmailError(error.message);
		throw error;
	}

	let inReplyTo: string | undefined;
	let subject = validated.subject;
	if (input.replyToMessageId) {
		const [original] = await db
			.select()
			.from(inboxMessages)
			.where(and(eq(inboxMessages.id, input.replyToMessageId), eq(inboxMessages.inboxId, inboxId)))
			.limit(1);
		if (!original) throw new SendEmailError("replyToMessageId not found in this inbox");
		if (original.messageId) {
			inReplyTo = asMessageIdHeader(original.messageId);
			if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
		}
	}

	let row: typeof inboxMessages.$inferSelect | undefined;
	if (input.idempotencyKey) {
		[row] = await db
			.select()
			.from(inboxMessages)
			.where(and(eq(inboxMessages.inboxId, inboxId), eq(inboxMessages.idempotencyKey, input.idempotencyKey)))
			.limit(1);
		if (row?.deliveryStatus === "sent" || row?.deliveryStatus === "sending") return row;
	}

	if (!row) {
		try {
			[row] = await db
				.insert(inboxMessages)
				.values({
					inboxId,
					direction: "outbound",
					fromAddress: input.inboxAddress,
					toAddress: validated.to.join(", "),
					subject,
					textBody: validated.text,
					htmlBody: validated.html,
					inReplyTo,
					sizeBytes: new TextEncoder().encode((validated.text ?? "") + (validated.html ?? "")).byteLength,
					deliveryStatus: "pending",
					idempotencyKey: input.idempotencyKey,
				})
				.returning();
		} catch (error) {
			if (!input.idempotencyKey || !isUniqueConstraintError(error)) throw error;
			[row] = await db
				.select()
				.from(inboxMessages)
				.where(and(eq(inboxMessages.inboxId, inboxId), eq(inboxMessages.idempotencyKey, input.idempotencyKey)))
				.limit(1);
			if (!row) throw error;
		}
	}

	const [claimed] = await db
		.update(inboxMessages)
		.set({
			deliveryStatus: "sending",
			deliveryAttempts: sql`${inboxMessages.deliveryAttempts} + 1`,
			deliveryError: null,
		})
		.where(
			and(
				eq(inboxMessages.id, row.id),
				or(eq(inboxMessages.deliveryStatus, "pending"), eq(inboxMessages.deliveryStatus, "failed")),
			),
		)
		.returning();
	if (!claimed) return row;

	try {
		const result = await env.EMAIL.send({
			to: validated.to,
			from: input.inboxAddress,
			subject,
			text: validated.text,
			html: validated.html,
			headers: {
				...(inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : {}),
				"X-HeadlessTools-Dispatch-ID": row.id,
			},
		});
		const [sent] = await db
			.update(inboxMessages)
			.set({ deliveryStatus: "sent", messageId: result.messageId, deliveryError: null })
			.where(eq(inboxMessages.id, row.id))
			.returning();
		return sent ?? { ...row, deliveryStatus: "sent" as const, messageId: result.messageId };
	} catch (error) {
		await db
			.update(inboxMessages)
			.set({ deliveryStatus: "failed", deliveryError: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000) })
			.where(eq(inboxMessages.id, row.id));
		throw new SendEmailError("failed to send email");
	}
}
