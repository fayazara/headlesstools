import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb, links, pastes, inboxes, inboxMessages, files } from "../db";

export async function cleanupExpired(env: Env) {
	const db = getDb(env.DB);
	const now = new Date();

	await db.delete(links).where(and(isNotNull(links.expiresAt), lt(links.expiresAt, now)));

	const expiredPastes = await db
		.select({ id: pastes.id, r2Key: pastes.r2Key })
		.from(pastes)
		.where(and(isNotNull(pastes.expiresAt), lt(pastes.expiresAt, now)));
	await Promise.all(expiredPastes.filter((p) => p.r2Key).map((p) => env.R2.delete(p.r2Key!)));
	if (expiredPastes.length > 0) {
		await db.delete(pastes).where(and(isNotNull(pastes.expiresAt), lt(pastes.expiresAt, now)));
	}

	const expiredFiles = await db
		.select({ id: files.id, r2Key: files.r2Key })
		.from(files)
		.where(and(isNotNull(files.expiresAt), lt(files.expiresAt, now)));
	await Promise.all(expiredFiles.map((f) => env.R2.delete(f.r2Key)));
	if (expiredFiles.length > 0) {
		await db.delete(files).where(and(isNotNull(files.expiresAt), lt(files.expiresAt, now)));
	}

	const expiredInboxes = await db
		.select({ id: inboxes.id })
		.from(inboxes)
		.where(and(isNotNull(inboxes.expiresAt), lt(inboxes.expiresAt, now)));

	for (const inbox of expiredInboxes) {
		const messages = await db
			.select({ rawR2Key: inboxMessages.rawR2Key })
			.from(inboxMessages)
			.where(eq(inboxMessages.inboxId, inbox.id));
		await Promise.all(
			messages.filter((m) => m.rawR2Key).map((m) => env.R2.delete(m.rawR2Key!)),
		);
		await db.delete(inboxMessages).where(eq(inboxMessages.inboxId, inbox.id));
		await db.delete(inboxes).where(eq(inboxes.id, inbox.id));
	}
}
