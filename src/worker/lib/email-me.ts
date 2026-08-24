import { and, eq, isNull, lt, lte, sql } from "drizzle-orm";
import { accounts, scheduledEmails, type Db } from "../../db";
import { InvalidEmailError, validateOutboundEmail } from "./email-validation";
import { assertOutboundEmailQuota, QuotaExceededError } from "./quotas";
import { isUniqueConstraintError } from "./validation";

const NOTIFY_FROM = "reminders@hdls.tools";
const MAX_ATTEMPTS = 5;
const MAX_DISPATCH_BATCH = 100;

export type EmailMeInput = {
	subject: string;
	text?: string;
	html?: string;
	at?: Date;
	idempotencyKey?: string;
};

export class EmailMeError extends Error {}

export async function emailMe(db: Db, env: Env, accountId: string, input: EmailMeInput) {
	const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
	if (!account) throw new EmailMeError("account not found");

	try {
		validateOutboundEmail({ to: account.email, subject: input.subject, text: input.text, html: input.html });
		await assertOutboundEmailQuota(db, accountId);
	} catch (error) {
		if (error instanceof InvalidEmailError || error instanceof QuotaExceededError) throw new EmailMeError(error.message);
		throw error;
	}

	if (input.idempotencyKey) {
		const [existing] = await db
			.select()
			.from(scheduledEmails)
			.where(and(eq(scheduledEmails.accountId, accountId), eq(scheduledEmails.idempotencyKey, input.idempotencyKey)))
			.limit(1);
		if (existing) return existing;
	}

	const sendAt = input.at && input.at.getTime() > Date.now() + 5_000 ? input.at : new Date();
	let row: typeof scheduledEmails.$inferSelect;
	try {
		[row] = await db
			.insert(scheduledEmails)
			.values({
				accountId,
				toAddress: account.email,
				subject: input.subject,
				textBody: input.text,
				htmlBody: input.html,
				sendAt,
				idempotencyKey: input.idempotencyKey,
			})
			.returning();
	} catch (error) {
		if (!input.idempotencyKey || !isUniqueConstraintError(error)) throw error;
		[row] = await db
			.select()
			.from(scheduledEmails)
			.where(and(eq(scheduledEmails.accountId, accountId), eq(scheduledEmails.idempotencyKey, input.idempotencyKey)))
			.limit(1);
		if (!row) throw error;
		return row;
	}

	if (sendAt.getTime() <= Date.now() + 5_000) {
		const delivered = await deliverScheduledEmail(env, db, row.id);
		if (delivered?.lastError && !delivered.sentAt) throw new EmailMeError("failed to email");
		return delivered ?? row;
	}
	return row;
}

async function deliverScheduledEmail(env: Env, db: Db, id: string) {
	const [claimed] = await db
		.update(scheduledEmails)
		.set({ sendingAt: new Date(), attempts: sql`${scheduledEmails.attempts} + 1`, lastError: null })
		.where(
			and(
				eq(scheduledEmails.id, id),
				isNull(scheduledEmails.sentAt),
				isNull(scheduledEmails.sendingAt),
				lt(scheduledEmails.attempts, MAX_ATTEMPTS),
			),
		)
		.returning();
	if (!claimed) return null;

	try {
		await env.EMAIL.send({
			to: claimed.toAddress,
			from: { email: NOTIFY_FROM, name: "headlesstools" },
			subject: claimed.subject,
			text: claimed.textBody ?? undefined,
			html: claimed.htmlBody ?? undefined,
			headers: { "X-HeadlessTools-Dispatch-ID": claimed.id },
		});
		const [sent] = await db
			.update(scheduledEmails)
			.set({ sentAt: new Date(), sendingAt: null, lastError: null })
			.where(eq(scheduledEmails.id, claimed.id))
			.returning();
		return sent;
	} catch (error) {
		const [failed] = await db
			.update(scheduledEmails)
			.set({
				sendingAt: null,
				lastError: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
			})
			.where(eq(scheduledEmails.id, claimed.id))
			.returning();
		return failed;
	}
}

export async function dispatchDueScheduledEmails(env: Env, db: Db) {
	const due = await db
		.select({ id: scheduledEmails.id })
		.from(scheduledEmails)
		.where(
			and(
				isNull(scheduledEmails.sentAt),
				isNull(scheduledEmails.sendingAt),
				lte(scheduledEmails.sendAt, new Date()),
				lt(scheduledEmails.attempts, MAX_ATTEMPTS),
			),
		)
		.limit(MAX_DISPATCH_BATCH);

	for (const row of due) await deliverScheduledEmail(env, db, row.id);
}
