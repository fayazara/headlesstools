const FEATURES = [
	{
		name: "url shortener",
		cmd: "shorten_url",
		desc: "turn a long url into a short, shareable one. click tracking included.",
	},
	{
		name: "pastebin",
		cmd: "create_paste",
		desc: "share text/code snippets with a link. private, unlisted, or burn-after-read.",
	},
	{
		name: "inbox",
		cmd: "create_inbox",
		desc: "get a disposable email address on demand. read otps, webhooks, signup mail, programmatically.",
	},
];

export function landingPage(origin: string): Response {
	const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>headlesstools</title>
<meta name="description" content="CLI-first, MCP-first SaaS tools for AI agents. URL shortener, pastebin, and disposable email inboxes." />
<style>
  :root {
    --sans: "SF Compact", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    --mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace;
    --ink: #111111;
    --dim: #6b6b6b;
    --line: #d9d9d9;
    --bg: #fbfbfa;
    --accent: #f97316;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--sans);
    color: var(--ink);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 24px; }
  header.nav {
    border-bottom: 1px solid var(--line);
    padding: 18px 0;
  }
  header.nav .wrap { display: flex; align-items: center; justify-content: space-between; }
  .logo { font-weight: 600; letter-spacing: -0.02em; text-decoration: none; }
  .navlinks a { margin-left: 24px; font-size: 14px; color: var(--dim); text-decoration: none; }
  .navlinks a:hover { color: var(--ink); }

  .hero { padding: 64px 0 40px; }
  .hero h1 { font-size: 34px; line-height: 1.25; margin: 0 0 14px; letter-spacing: -0.02em; }
  .hero p { font-size: 16px; color: var(--dim); max-width: 560px; margin: 0 0 28px; line-height: 1.6; }
  .cta { display: flex; gap: 10px; flex-wrap: wrap; }
  .cta code {
    font-family: var(--mono);
    font-size: 13px;
    background: var(--ink);
    color: #f5f5f5;
    padding: 10px 14px;
    border-radius: 6px;
    display: inline-block;
  }

  section { margin-bottom: 64px; }
  h2 {
    font-family: var(--mono);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
    margin: 0 0 18px;
  }

  .features {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--line);
    background: var(--line);
    gap: 1px;
  }
  .feature { background: #fff; padding: 22px; }
  .feature .name { font-weight: 600; margin-bottom: 6px; }
  .feature .tool {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--accent);
    display: block;
    margin-bottom: 10px;
  }
  .feature p { font-size: 13.5px; color: var(--dim); line-height: 1.55; margin: 0; }

  .docs pre {
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    border: 1px solid var(--line);
    background: #fff;
    padding: 16px 18px;
    overflow-x: auto;
    margin: 0 0 14px;
  }
  .docs .label { font-size: 13px; color: var(--dim); margin: 0 0 8px; }
  .docs h3 { font-size: 14px; font-weight: 600; margin: 32px 0 4px; }
  .docs h3:first-of-type { margin-top: 0; }

  footer {
    border-top: 1px solid var(--line);
    padding: 24px 0 48px;
    font-size: 12.5px;
    color: var(--dim);
  }

  @media (max-width: 640px) {
    .features { grid-template-columns: 1fr; }
    .hero h1 { font-size: 26px; }
  }
</style>
</head>
<body>
  <header class="nav">
    <div class="wrap">
      <a class="logo" href="/">headlesstools</a>
      <nav class="navlinks">
        <a href="#features">features</a>
        <a href="#docs">docs</a>
      </nav>
    </div>
  </header>

  <div class="wrap">
    <section class="hero">
      <h1>SaaS tools built for agents, not dashboards.</h1>
      <p>A url shortener, a pastebin, and a disposable email inbox &mdash; each one CLI-first and MCP-first, so an agent can use them like it uses any other tool call.</p>
      <div class="cta">
        <code>claude mcp add --transport http headlesstools ${origin}/mcp</code>
      </div>
    </section>

    <section id="features">
      <h2>features</h2>
      <div class="features">
        ${FEATURES.map(
					(f) => `<div class="feature">
          <span class="name">${f.name}</span>
          <span class="tool">${f.cmd}()</span>
          <p>${f.desc}</p>
        </div>`,
				).join("\n")}
      </div>
    </section>

    <section id="docs" class="docs">
      <h2>docs</h2>
      <p class="label">connect via MCP &mdash; opens a browser once, no token to copy</p>

      <h3>Claude Code</h3>
      <pre>$ claude mcp add --transport http headlesstools \
    ${origin}/mcp</pre>

      <h3>Codex CLI</h3>
      <pre># ~/.codex/config.toml
[mcp_servers.headlesstools]
url = "${origin}/mcp"

$ codex mcp login headlesstools</pre>

      <h3>OpenCode</h3>
      <pre>// opencode.json
{
  "mcp": {
    "headlesstools": {
      "type": "remote",
      "url": "${origin}/mcp"
    }
  }
}</pre>

      <p class="label">or use the REST API directly</p>
      <pre>$ curl -X POST ${origin}/v1/auth/signup -d '{"email":"you@example.com"}'
$ curl -X POST ${origin}/v1/auth/verify -d '{"email":"...","code":"123456"}'
&gt; {"apiKey":"hlt_live_..."}

$ curl -X POST ${origin}/v1/links -H "authorization: Bearer hlt_live_..." \
    -d '{"url":"https://example.com"}'
$ curl -X POST ${origin}/v1/pastes -H "authorization: Bearer hlt_live_..." \
    -d '{"content":"hello world"}'
$ curl -X POST ${origin}/v1/inboxes -H "authorization: Bearer hlt_live_..."</pre>
    </section>
  </div>

  <footer>
    <div class="wrap">headlesstools &mdash; cli-first, mcp-first tools for ai agents</div>
  </footer>
</body>
</html>`;

	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
