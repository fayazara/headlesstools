import { and, eq, isNull, lte } from "drizzle-orm";
import { accounts, scheduledEmails, type Db } from "../../db";

const NOTIFY_FROM = "reminders@fayazahmed.com";
const MAX_ATTEMPTS = 5;

export type EmailMeInput = {
	subject: string;
	text?: string;
	html?: string;
	at?: Date;
};

export class EmailMeError extends Error {}

export async function emailMe(db: Db, env: Env, accountId: string, input: EmailMeInput) {
	if (!input.text && !input.html) {
		throw new EmailMeError("text or html required");
	}

	const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
	if (!account) throw new EmailMeError("account not found");

	const sendAt = input.at;
	const isFuture = sendAt && sendAt.getTime() > Date.now() + 5_000;

	if (!isFuture || !sendAt) {
		await env.EMAIL.send({
			to: account.email,
			from: { email: NOTIFY_FROM, name: "headlesstools" },
			subject: input.subject,
			text: input.text,
			html: input.html,
		});

		const [row] = await db
			.insert(scheduledEmails)
			.values({
				accountId,
				toAddress: account.email,
				subject: input.subject,
				textBody: input.text,
				htmlBody: input.html,
				sendAt: new Date(),
				sentAt: new Date(),
			})
			.returning();
		return row;
	}

	const [row] = await db
		.insert(scheduledEmails)
		.values({
			accountId,
			toAddress: account.email,
			subject: input.subject,
			textBody: input.text,
			htmlBody: input.html,
			sendAt,
		})
		.returning();
	return row;
}

export async function dispatchDueScheduledEmails(env: Env, db: Db) {
	const due = await db
		.select()
		.from(scheduledEmails)
		.where(and(isNull(scheduledEmails.sentAt), lte(scheduledEmails.sendAt, new Date())));

	for (const row of due) {
		if (row.attempts >= MAX_ATTEMPTS) continue;
		try {
			await env.EMAIL.send({
				to: row.toAddress,
				from: { email: NOTIFY_FROM, name: "headlesstools" },
				subject: row.subject,
				text: row.textBody ?? undefined,
				html: row.htmlBody ?? undefined,
			});
			await db.update(scheduledEmails).set({ sentAt: new Date() }).where(eq(scheduledEmails.id, row.id));
		} catch (err) {
			await db
				.update(scheduledEmails)
				.set({ attempts: row.attempts + 1, lastError: err instanceof Error ? err.message : String(err) })
				.where(eq(scheduledEmails.id, row.id));
		}
	}
}
