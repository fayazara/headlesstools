import { Hono } from "hono";
import authRoutes from "./routes/auth";
import linkRoutes from "./routes/links";
import pasteRoutes from "./routes/pastes";
import pasteRawRoutes from "./routes/paste-raw";
import inboxRoutes from "./routes/inboxes";
import emailMeRoutes from "./routes/email-me";
import fileRoutes from "./routes/files";
import fileRawRoutes from "./routes/file-raw";
import redirectRoutes from "./routes/redirect";
import { handleEmail } from "./email";
import { cleanupExpired } from "./cleanup";
import { createOAuthProvider, oauthRoutes } from "./oauth";
import landingRoutes from "./landing";
import { dispatchDueScheduledEmails } from "./lib/email-me";
import { getDb } from "../db";
import { InvalidBodyError, PayloadTooLargeError, readBodyWithLimit } from "./lib/body";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
	await next();
	c.res.headers.set("x-content-type-options", "nosniff");
	c.res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
	c.res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
	if (new URL(c.req.url).pathname.startsWith("/v1/") && !c.res.headers.has("cache-control")) {
		c.res.headers.set("cache-control", "no-store");
	}
});

app.route("/", landingRoutes);
app.route("/v1/auth", authRoutes);
app.route("/v1/links", linkRoutes);
app.route("/v1/pastes", pasteRoutes);
app.route("/v1/inboxes", inboxRoutes);
app.route("/v1/email-me", emailMeRoutes);
app.route("/v1/files", fileRoutes);
app.route("/", oauthRoutes);

// paste content lives at /p/:slug as raw text (not JSON-wrapped, so opening
// the link shows just the content) so it doesn't collide with the top-level
// short-link redirect namespace below
app.route("/p", pasteRawRoutes);

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
	fetch: async (request, env, ctx) => {
		const declaredLength = Number(request.headers.get("content-length") ?? 0);
		if (Number.isFinite(declaredLength) && declaredLength > 12 * 1024 * 1024) {
			return Response.json({ error: "request body too large" }, { status: 413 });
		}
		const path = new URL(request.url).pathname;
		if (request.body && (path === "/oauth/token" || path === "/oauth/register")) {
			try {
				const body = await readBodyWithLimit(request, 64 * 1024);
				request = new Request(request, { body });
			} catch (error) {
				if (error instanceof PayloadTooLargeError) return Response.json({ error: error.message }, { status: 413 });
				if (error instanceof InvalidBodyError) return Response.json({ error: error.message }, { status: 400 });
				throw error;
			}
		}
		return oauthProvider.fetch(request, env, ctx);
	},
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
