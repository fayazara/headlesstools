import { Hono } from "hono";
import { getDb } from "../../db";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { checkRateLimit } from "../lib/rate-limit";
import { emailMe, EmailMeError } from "../lib/email-me";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/", requireAuth, async (c) => {
	if (!(await checkRateLimit(c.env.SEND_RATE_LIMITER, c.get("accountId")))) {
		return c.json({ error: "rate limit exceeded, try again shortly" }, 429);
	}

	const body = await c.req.json().catch(() => null);
	const subject = typeof body?.subject === "string" ? body.subject : "";
	const text = typeof body?.text === "string" ? body.text : undefined;
	const html = typeof body?.html === "string" ? body.html : undefined;
	const at = typeof body?.at === "string" ? new Date(body.at) : undefined;

	if (!subject || (!text && !html)) {
		return c.json({ error: "subject and text or html are required" }, 400);
	}
	if (at && Number.isNaN(at.getTime())) {
		return c.json({ error: "invalid 'at' timestamp" }, 400);
	}

	try {
		const row = await emailMe(getDb(c.env.DB), c.env, c.get("accountId"), { subject, text, html, at });
		return c.json(row, 201);
	} catch (err) {
		if (err instanceof EmailMeError) return c.json({ error: err.message }, 400);
		throw err;
	}
});

export default app;
