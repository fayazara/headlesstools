import { Hono } from "hono";
import OAuthProvider, { AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { getDb } from "../db";
import { sendLoginCode, resolveAccountFromCode } from "./lib/auth-flow";
import { checkRateLimit, clientIp } from "./lib/rate-limit";
import { accountIdForApiKey } from "./lib/account";
import { mcpApiHandler, type McpAuthProps } from "./mcp";

const SCOPE = "mcp";

function page(title: string, body: string) {
	return new Response(
		`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #141414; border: 1px solid #262626; border-radius: 12px; padding: 32px; width: 100%; max-width: 380px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: #a3a3a3; font-size: 14px; margin: 0 0 24px; }
  label { display: block; font-size: 13px; color: #d4d4d4; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #333; background: #0a0a0a; color: #fff; font-size: 14px; margin-bottom: 16px; }
  button { width: 100%; padding: 10px 12px; border-radius: 8px; border: none; background: #f97316; color: #0a0a0a; font-weight: 600; font-size: 14px; cursor: pointer; }
  .error { color: #f87171; font-size: 13px; margin-bottom: 16px; }
  .brand { font-size: 12px; color: #737373; margin-top: 20px; text-align: center; }
</style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`,
		{ headers: { "content-type": "text/html; charset=utf-8" } },
	);
}

function errorRedirect(err: AuthorizationError) {
	if (!err.redirectUri) {
		return new Response(err.description, { status: 400 });
	}
	const redirect = new URL(err.redirectUri);
	redirect.searchParams.set("error", err.code);
	redirect.searchParams.set("error_description", err.description);
	if (err.state) redirect.searchParams.set("state", err.state);
	if (err.issuer) redirect.searchParams.set("iss", err.issuer);
	return Response.redirect(redirect.toString(), 302);
}

const oauthRoutes = new Hono<{ Bindings: Env }>();

// Step 1: entry point from the MCP client's browser redirect. Re-validated
// (via parseAuthRequest) on every step rather than trusting a client-editable
// hidden field, by round-tripping the raw querystring instead of pre-parsed data.
oauthRoutes.get("/authorize", async (c) => {
	let authRequest: AuthRequest;
	try {
		authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	} catch (err) {
		if (err instanceof AuthorizationError) return errorRedirect(err);
		throw err;
	}

	const client = await c.env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
	if (!client) return new Response("Unknown OAuth client", { status: 400 });

	const search = new URL(c.req.url).search;
	return page(
		"Connect to headlesstools",
		`<h1>Connect ${escapeHtml(client.clientName ?? authRequest.clientId)}</h1>
		<p class="sub">Enter your email to sign in to headlesstools.</p>
		<form method="POST" action="/authorize/code">
			<input type="hidden" name="qs" value="${escapeHtml(search)}" />
			<label for="email">Email</label>
			<input type="email" id="email" name="email" required autofocus />
			<button type="submit">Send login code</button>
		</form>
		<p class="brand">headlesstools</p>`,
	);
});

// Step 2: send a login code, show the code-entry form.
oauthRoutes.post("/authorize/code", async (c) => {
	const body = await c.req.parseBody();
	const qs = typeof body.qs === "string" ? body.qs : "";
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

	if (!email || !email.includes("@")) {
		return renderCodeStep(qs, "", "Enter a valid email address");
	}

	if (!(await checkRateLimit(c.env.LOGIN_CODE_RATE_LIMITER, clientIp(c.req.raw)))) {
		return renderCodeStep(qs, email, "Too many requests, try again shortly");
	}

	await sendLoginCode(getDb(c.env.DB), c.env, email);
	return renderCodeStep(qs, email);
});

// Step 3: verify the code and complete the OAuth grant.
oauthRoutes.post("/authorize/verify", async (c) => {
	const body = await c.req.parseBody();
	const qs = typeof body.qs === "string" ? body.qs : "";
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const code = typeof body.code === "string" ? body.code.trim() : "";

	if (!(await checkRateLimit(c.env.VERIFY_RATE_LIMITER, clientIp(c.req.raw)))) {
		return renderCodeStep(qs, email, "Too many attempts, try again shortly");
	}

	const db = getDb(c.env.DB);
	const account = await resolveAccountFromCode(db, email, code);
	if (!account) {
		return renderCodeStep(qs, email, "Invalid or expired code");
	}

	let authRequest: AuthRequest;
	try {
		authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(new Request(new URL(`/authorize${qs}`, c.req.url)));
	} catch (err) {
		if (err instanceof AuthorizationError) return errorRedirect(err);
		throw err;
	}

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: authRequest,
		userId: account.id,
		metadata: { email: account.email },
		scope: [SCOPE],
		props: { accountId: account.id, email: account.email } satisfies McpAuthProps,
	});

	return Response.redirect(redirectTo, 302);
});

async function renderCodeStep(qs: string, email: string, error?: string) {
	return page(
		"Enter your code",
		`<h1>Check your email</h1>
		<p class="sub">We sent a login code to ${escapeHtml(email)}.</p>
		${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
		<form method="POST" action="/authorize/verify">
			<input type="hidden" name="qs" value="${escapeHtml(qs)}" />
			<input type="hidden" name="email" value="${escapeHtml(email)}" />
			<label for="code">Login code</label>
			<input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autofocus />
			<button type="submit">Verify</button>
		</form>
		<p class="brand">headlesstools</p>`,
	);
}

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function createOAuthProvider(defaultHandler: {
	fetch: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
}) {
	return new OAuthProvider<Env>({
		apiRoute: "/mcp",
		apiHandler: mcpApiHandler,
		defaultHandler,
		authorizeEndpoint: "/authorize",
		tokenEndpoint: "/oauth/token",
		clientRegistrationEndpoint: "/oauth/register",
		clientIdMetadataDocumentEnabled: true,
		scopesSupported: [SCOPE],
		resourceMetadata: {
			resource_name: "headlesstools",
			scopes_supported: [SCOPE],
		},
		resolveExternalToken: async (input) => {
			// Backward compatibility: our static hlt_live_... REST API keys
			// also work directly as MCP bearer tokens, no OAuth flow required.
			if (!input.token.startsWith("hlt_live_")) return null;
			const db = getDb(input.env.DB);
			const accountId = await accountIdForApiKey(db, input.token);
			if (!accountId) return null;
			return { props: { accountId, email: "" } satisfies McpAuthProps };
		},
	});
}

export { oauthRoutes };
