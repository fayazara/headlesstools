import { and, eq, isNull } from "drizzle-orm";
import { getDb, accounts, apiKeys } from "../../db";
import { hashApiKey } from "./keys";

export async function accountIdForApiKey(db: ReturnType<typeof getDb>, token: string): Promise<string | null> {
	const keyHash = await hashApiKey(token);
	const [row] = await db
		.select({ accountId: apiKeys.accountId })
		.from(apiKeys)
		.innerJoin(accounts, eq(accounts.id, apiKeys.accountId))
		.where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
		.limit(1);
	return row?.accountId ?? null;
}
