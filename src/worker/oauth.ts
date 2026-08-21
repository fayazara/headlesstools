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
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #fbfbfa;
    color: #111111;
    font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%;
    max-width: 380px;
    overflow: hidden;
    border: 1px solid #d9d9d9;
    border-radius: 10px;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 10px 28px -16px rgba(0, 0, 0, 0.14);
  }
  .card-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 10px 14px;
    border-bottom: 1px solid #d9d9d9;
    background: #f5f5f4;
  }
  .card-header .dot {
    display: inline-block;
    height: 8px;
    width: 8px;
    border-radius: 999px;
    background: #d9d9d9;
  }
  .card-header .label {
    margin-left: 4px;
    font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11.5px;
    color: #6b6b6b;
  }
  .card-body { padding: 26px 24px 24px; }
  h1 { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 4px; }
  p.sub { color: #6b6b6b; font-size: 13.5px; line-height: 1.5; margin: 0 0 22px; }
  label { display: block; font-size: 12.5px; font-weight: 500; color: #111111; margin-bottom: 6px; }
  input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid #d9d9d9;
    background: #ffffff;
    color: #111111;
    font-size: 14px;
    font-family: inherit;
    margin-bottom: 18px;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }
  input:focus {
    outline: none;
    border-color: #f97316;
    box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
  }
  input#code {
    font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 18px;
    letter-spacing: 0.3em;
    text-align: center;
  }
  button {
    width: 100%;
    padding: 10px 12px;
    border-radius: 6px;
    border: none;
    background: #f97316;
    color: #111111;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 150ms ease, transform 120ms ease-out;
  }
  button:hover { background: #ea6a0f; }
  button:active { transform: scale(0.97); }
  button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.3); }
  .error {
    margin: 0 0 16px;
    border: 1px solid #fecaca;
    border-radius: 6px;
    background: #fef2f2;
    padding: 8px 10px;
    color: #b91c1c;
    font-size: 12.5px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="label">headlesstools · sign in</span>
    </div>
    <div class="card-body">${body}</div>
  </div>
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
			<input type="email" id="email" name="email" placeholder="you@example.com" required autofocus />
			<button type="submit">Send login code</button>
		</form>`,
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
			<input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" required autofocus />
			<button type="submit">Verify</button>
		</form>`,
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
