import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb, accounts, loginCodes } from "../../db";
import { generateLoginCode, hashLoginCode } from "./keys";

const CODE_TTL_MS = 10 * 60 * 1000;
const AUTH_FROM = "auth@hdls.tools";

export async function sendLoginCode(
	env: Env,
	email: string,
	ctx: { waitUntil: (promise: Promise<unknown>) => void },
) {
	const code = generateLoginCode();
	const codeHash = await hashLoginCode(code);
	const now = Date.now();
	const id = crypto.randomUUID();
	// D1 batch is transactional: concurrent requests leave only the newest code
	// usable instead of accumulating several valid codes for one address.
	await env.DB.batch([
		env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL").bind(
			Math.floor(now / 1000),
			email,
		),
		env.DB.prepare(
			"INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
		).bind(id, email, codeHash, Math.floor((now + CODE_TTL_MS) / 1000), Math.floor(now / 1000)),
	]);

	// The code is already persisted, so let the page respond right away
	// instead of blocking navigation on the outbound email round-trip.
	ctx.waitUntil(
		env.EMAIL.send({
			to: email,
			from: { email: AUTH_FROM, name: "headlesstools" },
			subject: `${code} is your headlesstools login code`,
			text: `Your login code is ${code}. It expires in 10 minutes.`,
			html: `<p>Your login code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
			}).catch((error) =>
				console.error(JSON.stringify({
					message: "login code email send failed",
					error: error instanceof Error ? error.message : String(error),
				})),
			),
		);
}

export async function resolveAccountFromCode(db: ReturnType<typeof getDb>, email: string, code: string) {
	const codeHash = await hashLoginCode(code);

	const [row] = await db
		.select()
		.from(loginCodes)
		.where(
			and(
				eq(loginCodes.email, email),
				eq(loginCodes.codeHash, codeHash),
				isNull(loginCodes.consumedAt),
				gt(loginCodes.expiresAt, new Date()),
			),
		)
		.orderBy(desc(loginCodes.createdAt))
		.limit(1);

	if (!row) return null;

	const consumed = await db
		.update(loginCodes)
		.set({ consumedAt: new Date() })
		.where(and(eq(loginCodes.id, row.id), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
		.returning();
	if (consumed.length === 0) return null;

	let [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
	if (!account) {
		[account] = await db.insert(accounts).values({ email }).onConflictDoNothing().returning();
		if (!account) [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
	}

	return account;
}
