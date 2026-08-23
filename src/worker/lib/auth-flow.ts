import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb, accounts, loginCodes } from "../../db";
import { generateLoginCode, hashLoginCode } from "./keys";

const CODE_TTL_MS = 10 * 60 * 1000;
const AUTH_FROM = "auth@hdls.tools";

export async function sendLoginCode(
	db: ReturnType<typeof getDb>,
	env: Env,
	email: string,
	ctx: { waitUntil: (promise: Promise<unknown>) => void },
) {
	const code = generateLoginCode();
	const codeHash = await hashLoginCode(code);

	await db.insert(loginCodes).values({
		email,
		codeHash,
		expiresAt: new Date(Date.now() + CODE_TTL_MS),
	});

	// The code is already persisted, so let the page respond right away
	// instead of blocking navigation on the outbound email round-trip.
	ctx.waitUntil(
		env.EMAIL.send({
			to: email,
			from: { email: AUTH_FROM, name: "headlesstools" },
			subject: `${code} is your headlesstools login code`,
			text: `Your login code is ${code}. It expires in 10 minutes.`,
			html: `<p>Your login code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
		}).catch((err) => console.error("sendLoginCode: email send failed", err)),
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

	await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));

	let [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
	if (!account) {
		[account] = await db.insert(accounts).values({ email }).returning();
	}

	return account;
}
