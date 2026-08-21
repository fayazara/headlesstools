import { eq } from "drizzle-orm";
import { pastes, apiKeys, type Db } from "../../db";
import { hashApiKey } from "./keys";

export type ResolvedPaste = {
	paste: typeof pastes.$inferSelect;
	content: string | undefined;
};

async function accountIdForKeyHash(db: Db, keyHash: string): Promise<string | null> {
	const [row] = await db.select({ accountId: apiKeys.accountId }).from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
	return row?.accountId ?? null;
}

export async function resolvePaste(
	db: Db,
	env: Env,
	slug: string,
	authHeader: string | null,
): Promise<ResolvedPaste | "not_found"> {
	const [paste] = await db.select().from(pastes).where(eq(pastes.slug, slug)).limit(1);
	if (!paste) return "not_found";
	if (paste.expiresAt && paste.expiresAt.getTime() < Date.now()) return "not_found";

	if (paste.visibility === "private") {
		const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
		const keyHash = token ? await hashApiKey(token) : "";
		const ownerId = keyHash ? await accountIdForKeyHash(db, keyHash) : null;
		if (!token || paste.accountId !== ownerId) return "not_found";
	}

	const content = paste.content ?? (paste.r2Key ? await (await env.R2.get(paste.r2Key))?.text() : undefined);

	if (paste.burnAfterRead) {
		if (paste.r2Key) await env.R2.delete(paste.r2Key);
		await db.delete(pastes).where(eq(pastes.id, paste.id));
	}

	return { paste, content };
}
