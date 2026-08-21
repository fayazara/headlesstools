import { Hono } from "hono";
import authRoutes from "./routes/auth";
import linkRoutes from "./routes/links";
import pasteRoutes from "./routes/pastes";
import inboxRoutes from "./routes/inboxes";
import emailMeRoutes from "./routes/email-me";
import fileRoutes from "./routes/files";
import fileRawRoutes from "./routes/file-raw";
import redirectRoutes from "./routes/redirect";
import { handleEmail } from "./email";
import { cleanupExpired } from "./cleanup";
import { createOAuthProvider, oauthRoutes } from "./oauth";
import { landingPage } from "./landing";
import { dispatchDueScheduledEmails } from "./lib/email-me";
import { getDb } from "../db";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => landingPage(new URL(c.req.url).origin));
app.route("/v1/auth", authRoutes);
app.route("/v1/links", linkRoutes);
app.route("/v1/pastes", pasteRoutes);
app.route("/v1/inboxes", inboxRoutes);
app.route("/v1/email-me", emailMeRoutes);
app.route("/v1/files", fileRoutes);
app.route("/", oauthRoutes);

// paste content lives at /p/:slug so it doesn't collide with the top-level
// short-link redirect namespace below; reuses pasteRoutes' GET /:slug handler
app.get("/p/:slug", async (c) => {
	const url = new URL(c.req.url);
	url.pathname = `/${c.req.param("slug")}`;
	return pasteRoutes.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
});

// raw file bytes live at /f/:slug (not JSON-wrapped, so the URL is directly
// usable as an image src / download link)
app.route("/f", fileRawRoutes);

// short-link redirects live at the bare root, mounted last so it never
// shadows /v1/*, /p/*, /authorize, or static assets
app.route("/", redirectRoutes);

// /mcp is handled separately by OAuthProvider (see oauth.ts), which validates
// the bearer token (OAuth grant or a legacy static API key) before routing
// into the MCP handler; everything else falls through to the Hono app above.
const oauthProvider = createOAuthProvider(app);

export default {
	fetch: (request, env, ctx) => oauthProvider.fetch(request, env, ctx),
	async email(message, env) {
		// awaited directly (not via ctx.waitUntil) since message.raw must be
		// consumed while the message is still guaranteed valid
		await handleEmail(message, env);
	},
	async scheduled(event, env) {
		if (event.cron === "0 * * * *") {
			await cleanupExpired(env);
			await oauthProvider.purgeExpiredData(env);
		}
		if (event.cron === "* * * * *") {
			await dispatchDueScheduledEmails(env, getDb(env.DB));
		}
	},
} satisfies ExportedHandler<Env>;
