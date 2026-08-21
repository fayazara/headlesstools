import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const timestampCol = (name: string) =>
	integer(name, { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date());

const createdAt = () => timestampCol("created_at");

export const accounts = sqliteTable("accounts", {
	id: id(),
	email: text("email").notNull().unique(),
	createdAt: createdAt(),
});

export const loginCodes = sqliteTable("login_codes", {
	id: id(),
	email: text("email").notNull(),
	codeHash: text("code_hash").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	consumedAt: integer("consumed_at", { mode: "timestamp" }),
	createdAt: createdAt(),
});

export const apiKeys = sqliteTable("api_keys", {
	id: id(),
	accountId: text("account_id")
		.notNull()
		.references(() => accounts.id),
	name: text("name").notNull(),
	keyPrefix: text("key_prefix").notNull(),
	keyHash: text("key_hash").notNull().unique(),
	createdAt: createdAt(),
	lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
	revokedAt: integer("revoked_at", { mode: "timestamp" }),
});

export const links = sqliteTable("links", {
	id: id(),
	slug: text("slug").notNull().unique(),
	targetUrl: text("target_url").notNull(),
	accountId: text("account_id")
		.notNull()
		.references(() => accounts.id),
	clicks: integer("clicks").notNull().default(0),
	createdAt: createdAt(),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
});

export const pastes = sqliteTable("pastes", {
	id: id(),
	slug: text("slug").notNull().unique(),
	accountId: text("account_id")
		.notNull()
		.references(() => accounts.id),
	content: text("content"),
	r2Key: text("r2_key"),
	sizeBytes: integer("size_bytes").notNull(),
	language: text("language"),
	visibility: text("visibility", { enum: ["unlisted", "private"] })
		.notNull()
		.default("unlisted"),
	burnAfterRead: integer("burn_after_read", { mode: "boolean" })
		.notNull()
		.default(false),
	createdAt: createdAt(),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
});

export const inboxes = sqliteTable("inboxes", {
	id: id(),
	address: text("address").notNull().unique(),
	accountId: text("account_id")
		.notNull()
		.references(() => accounts.id),
	createdAt: createdAt(),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
});

export const inboxMessages = sqliteTable("inbox_messages", {
	id: id(),
	inboxId: text("inbox_id")
		.notNull()
		.references(() => inboxes.id),
	direction: text("direction", { enum: ["inbound", "outbound"] })
		.notNull()
		.default("inbound"),
	fromAddress: text("from_address").notNull(),
	toAddress: text("to_address").notNull(),
	subject: text("subject"),
	textBody: text("text_body"),
	htmlBody: text("html_body"),
	rawR2Key: text("raw_r2_key"),
	messageId: text("message_id"),
	inReplyTo: text("in_reply_to"),
	receivedAt: timestampCol("received_at"),
	readAt: integer("read_at", { mode: "timestamp" }),
});
