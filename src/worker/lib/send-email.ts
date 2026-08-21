import { eq } from "drizzle-orm";
import { inboxMessages, type Db } from "../../db";

export type SendEmailInput = {
	inboxAddress: string;
	to: string | string[];
	subject: string;
	text?: string;
	html?: string;
	replyToMessageId?: string;
};

export class SendEmailError extends Error {}

function asMessageIdHeader(value: string): string {
	return value.startsWith("<") ? value : `<${value}>`;
}

export async function sendFromInbox(db: Db, env: Env, inboxId: string, input: SendEmailInput) {
	let inReplyTo: string | undefined;
	let subject = input.subject;

	if (input.replyToMessageId) {
		const [original] = await db
			.select()
			.from(inboxMessages)
			.where(eq(inboxMessages.id, input.replyToMessageId))
			.limit(1);
		if (!original || original.inboxId !== inboxId) {
			throw new SendEmailError("replyToMessageId not found in this inbox");
		}
		if (original.messageId) {
			inReplyTo = asMessageIdHeader(original.messageId);
			if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
		}
	}

	// "Message-ID" isn't a settable custom header (Cloudflare assigns its own,
	// returned below); In-Reply-To/References are whitelisted and safe to set.
	const result = await env.EMAIL.send({
		to: input.to,
		from: input.inboxAddress,
		subject,
		text: input.text,
		html: input.html,
		headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : undefined,
	});

	const [row] = await db
		.insert(inboxMessages)
		.values({
			inboxId,
			direction: "outbound",
			fromAddress: input.inboxAddress,
			toAddress: Array.isArray(input.to) ? input.to.join(", ") : input.to,
			subject,
			textBody: input.text,
			htmlBody: input.html,
			messageId: result.messageId,
			inReplyTo,
		})
		.returning();

	return row;
}
