import { createMiddleware } from "hono/factory";
import { checkRateLimit } from "../lib/rate-limit";
import type { AuthVariables } from "./auth";

// Applied after requireAuth on resource-creation routes to cap spam from a
// single account (link/paste/inbox creation), keyed by accountId per
// Cloudflare's own guidance to avoid IP-based limits on authenticated routes.
export const requireCreateRateLimit = createMiddleware<{
	Bindings: Env;
	Variables: AuthVariables;
}>(async (c, next) => {
	const ok = await checkRateLimit(c.env.CREATE_RATE_LIMITER, c.get("accountId"));
	if (!ok) {
		return c.json({ error: "rate limit exceeded, try again shortly" }, 429);
	}
	await next();
});
