import { and, count, eq, gte, sum } from "drizzle-orm";
import { files, inboxes, inboxMessages, links, pastes, scheduledEmails, type Db } from "../../db";

export const MAX_LINKS_PER_ACCOUNT = 1_000;
export const MAX_PASTES_PER_ACCOUNT = 500;
export const MAX_PASTE_BYTES = 1024 * 1024;
export const MAX_FILES_PER_ACCOUNT = 100;
export const MAX_FILE_STORAGE_BYTES = 500 * 1024 * 1024;
export const MAX_OUTBOUND_EMAILS_PER_DAY = 100;
export const MAX_INBOUND_MESSAGES_PER_INBOX = 1_000;
export const MAX_INBOUND_STORAGE_BYTES = 250 * 1024 * 1024;
export const MAX_INBOUND_MESSAGE_BYTES = 5 * 1024 * 1024;
export const INBOX_MESSAGE_RETENTION_DAYS = 30;

export class QuotaExceededError extends Error {}

async function getCount(db: Db, table: typeof links | typeof pastes | typeof files, accountId: string) {
	const [row] = await db.select({ value: count() }).from(table).where(eq(table.accountId, accountId));
	return row?.value ?? 0;
}

export async function assertLinkQuota(db: Db, accountId: string) {
	if ((await getCount(db, links, accountId)) >= MAX_LINKS_PER_ACCOUNT) {
		throw new QuotaExceededError(`link quota exceeded (${MAX_LINKS_PER_ACCOUNT})`);
	}
}

export async function assertPasteQuota(db: Db, accountId: string, sizeBytes: number) {
	if (sizeBytes > MAX_PASTE_BYTES) {
		throw new QuotaExceededError(`paste exceeds ${MAX_PASTE_BYTES / (1024 * 1024)}MB limit`);
	}
	if ((await getCount(db, pastes, accountId)) >= MAX_PASTES_PER_ACCOUNT) {
		throw new QuotaExceededError(`paste quota exceeded (${MAX_PASTES_PER_ACCOUNT})`);
	}
}

export async function assertFileQuota(db: Db, accountId: string, addedBytes = 0) {
	const [row] = await db
		.select({ count: count(), bytes: sum(files.sizeBytes) })
		.from(files)
		.where(eq(files.accountId, accountId));
	if ((row?.count ?? 0) >= MAX_FILES_PER_ACCOUNT) {
		throw new QuotaExceededError(`file quota exceeded (${MAX_FILES_PER_ACCOUNT})`);
	}
	const storedBytes = Number(row?.bytes ?? 0);
	if (storedBytes + addedBytes > MAX_FILE_STORAGE_BYTES) {
		throw new QuotaExceededError(`file storage quota exceeded (${MAX_FILE_STORAGE_BYTES / (1024 * 1024)}MB)`);
	}
}

function startOfUtcDay() {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function assertOutboundEmailQuota(db: Db, accountId: string) {
	const since = startOfUtcDay();
	const [[reminders], [inboxSends]] = await Promise.all([
		db.select({ value: count() }).from(scheduledEmails).where(and(eq(scheduledEmails.accountId, accountId), gte(scheduledEmails.createdAt, since))),
		db
			.select({ value: count() })
			.from(inboxMessages)
			.innerJoin(inboxes, eq(inboxes.id, inboxMessages.inboxId))
			.where(and(eq(inboxMessages.direction, "outbound"), gte(inboxMessages.receivedAt, since), eq(inboxes.accountId, accountId))),
	]);
	if ((reminders?.value ?? 0) + (inboxSends?.value ?? 0) >= MAX_OUTBOUND_EMAILS_PER_DAY) {
		throw new QuotaExceededError(`daily outbound email quota exceeded (${MAX_OUTBOUND_EMAILS_PER_DAY})`);
	}
}

export async function assertInboundEmailQuota(db: Db, inboxId: string, addedBytes: number) {
	if (addedBytes > MAX_INBOUND_MESSAGE_BYTES) {
		throw new QuotaExceededError(`message exceeds ${MAX_INBOUND_MESSAGE_BYTES / (1024 * 1024)}MB limit`);
	}
	const [row] = await db
		.select({ count: count(), bytes: sum(inboxMessages.sizeBytes) })
		.from(inboxMessages)
		.where(and(eq(inboxMessages.inboxId, inboxId), eq(inboxMessages.direction, "inbound")));
	if ((row?.count ?? 0) >= MAX_INBOUND_MESSAGES_PER_INBOX) {
		throw new QuotaExceededError("inbox message quota exceeded");
	}
	if (Number(row?.bytes ?? 0) + addedBytes > MAX_INBOUND_STORAGE_BYTES) {
		throw new QuotaExceededError("inbox storage quota exceeded");
	}
}
