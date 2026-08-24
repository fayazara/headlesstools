import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { claimUploadToken, createFileFromBytes, createUploadToken } from "../src/worker/lib/files";
import { generateSlug, hashApiKey, hashLoginCode, validateCustomSlug } from "../src/worker/lib/keys";
import { resolvePaste } from "../src/worker/lib/pastes";
import { resolveAccountFromCode } from "../src/worker/lib/auth-flow";
import fileRawRoutes from "../src/worker/routes/file-raw";
import { sendFromInbox } from "../src/worker/lib/send-email";

async function seedAccount(id: string, email: string) {
	await env.DB.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)")
		.bind(id, email, Math.floor(Date.now() / 1000))
		.run();
}

describe("security-sensitive workflows", () => {
	it("generates non-enumerable default slugs and rejects reserved root slugs", () => {
		const slugs = new Set(Array.from({ length: 256 }, () => generateSlug()));
		expect(slugs.size).toBe(256);
		for (const slug of slugs) expect(slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{26}$/);
		expect(() => validateCustomSlug("oauth", { root: true })).toThrow("slug is reserved");
	});

	it("consumes an upload token exactly once across concurrent claims", async () => {
		const accountId = crypto.randomUUID();
		await seedAccount(accountId, `${accountId}@example.com`);
		const { token } = await createUploadToken(getDb(env.DB), accountId, { filename: "launch.txt" });

		const claims = await Promise.all([
			claimUploadToken(getDb(env.DB), token),
			claimUploadToken(getDb(env.DB), token),
		]);
		expect(claims.filter(Boolean)).toHaveLength(1);
	});

	it("does not authorize a revoked API key for a private paste", async () => {
		const accountId = crypto.randomUUID();
		const rawKey = `hlt_live_${crypto.randomUUID().replaceAll("-", "")}`;
		const keyHash = await hashApiKey(rawKey);
		await seedAccount(accountId, `${accountId}@example.com`);
		await env.DB.prepare(
			"INSERT INTO api_keys (id, account_id, name, key_prefix, key_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(crypto.randomUUID(), accountId, "revoked", rawKey.slice(0, 15), keyHash, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))
			.run();
		const slug = generateSlug();
		await env.DB.prepare(
			"INSERT INTO pastes (id, slug, account_id, content, size_bytes, visibility, burn_after_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(crypto.randomUUID(), slug, accountId, "private", 7, "private", 0, Math.floor(Date.now() / 1000))
			.run();

		expect(await resolvePaste(getDb(env.DB), env, slug, `Bearer ${rawKey}`)).toBe("not_found");
	});

	it("allows only one concurrent reader to claim a burn-after-read paste", async () => {
		const accountId = crypto.randomUUID();
		await seedAccount(accountId, `${accountId}@example.com`);
		const slug = generateSlug();
		await env.DB.prepare(
			"INSERT INTO pastes (id, slug, account_id, content, size_bytes, visibility, burn_after_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(crypto.randomUUID(), slug, accountId, "once", 4, "unlisted", 1, Math.floor(Date.now() / 1000))
			.run();

		const reads = await Promise.all([
			resolvePaste(getDb(env.DB), env, slug, null),
			resolvePaste(getDb(env.DB), env, slug, null),
		]);
		expect(reads.filter((result) => result !== "not_found")).toHaveLength(1);
	});

	it("consumes a login code atomically under concurrent verification", async () => {
		const email = `${crypto.randomUUID()}@example.com`;
		const code = "123456";
		const now = Math.floor(Date.now() / 1000);
		await env.DB.prepare(
			"INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
		)
			.bind(crypto.randomUUID(), email, await hashLoginCode(code), now + 600, now)
			.run();

		const attempts = await Promise.all([
			resolveAccountFromCode(getDb(env.DB), email, code),
			resolveAccountFromCode(getDb(env.DB), email, code),
		]);
		expect(attempts.filter(Boolean)).toHaveLength(1);
	});

	it("forces active uploaded content to download with restrictive headers", async () => {
		const accountId = crypto.randomUUID();
		const slug = generateSlug();
		const r2Key = `files/${slug}`;
		await seedAccount(accountId, `${accountId}@example.com`);
		await env.R2.put(r2Key, "<svg onload=alert(1)></svg>");
		await env.DB.prepare(
			"INSERT INTO files (id, slug, account_id, r2_key, filename, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(crypto.randomUUID(), slug, accountId, r2Key, "payload.svg", "image/svg+xml", 29, Math.floor(Date.now() / 1000))
			.run();

		const response = await fileRawRoutes.request(`https://hdls.tools/${slug}`, undefined, env);
		expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
		expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("does not overwrite an existing R2 object when a custom file slug collides", async () => {
		const accountId = crypto.randomUUID();
		const slug = `collision-${crypto.randomUUID().slice(0, 8)}`;
		await seedAccount(accountId, `${accountId}@example.com`);
		await createFileFromBytes(getDb(env.DB), env, accountId, new TextEncoder().encode("first"), {
			filename: "first.txt",
			slug,
		}, "https://hdls.tools");

		await expect(createFileFromBytes(getDb(env.DB), env, accountId, new TextEncoder().encode("second"), {
			filename: "second.txt",
			slug,
		}, "https://hdls.tools")).rejects.toThrow("slug already taken");
		expect(await (await env.R2.get(`files/${slug}`))?.text()).toBe("first");
	});

	it("sends only once for concurrent retries with one idempotency key", async () => {
		const accountId = crypto.randomUUID();
		const inboxId = crypto.randomUUID();
		const address = `${accountId}@hdls.tools`;
		await seedAccount(accountId, `${accountId}@example.com`);
		await env.DB.prepare("INSERT INTO inboxes (id, address, account_id, created_at) VALUES (?, ?, ?, ?)")
			.bind(inboxId, address, accountId, Math.floor(Date.now() / 1000))
			.run();

		let sendCount = 0;
		const emailEnv = {
			EMAIL: {
				async send() {
					sendCount++;
					await Promise.resolve();
					return { messageId: crypto.randomUUID() };
				},
			},
		} as unknown as Env;
		const input = {
			inboxAddress: address,
			to: "recipient@example.com",
			subject: "Retry-safe",
			text: "hello",
			idempotencyKey: `retry-${crypto.randomUUID()}`,
		};

		await Promise.all([
			sendFromInbox(getDb(env.DB), emailEnv, accountId, inboxId, input),
			sendFromInbox(getDb(env.DB), emailEnv, accountId, inboxId, input),
		]);
		expect(sendCount).toBe(1);
	});
});
