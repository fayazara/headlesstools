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
		name: "mailbox",
		cmd: "create_inbox",
		desc: "get a real email address on demand &mdash; read otps and webhooks, and send replies too. full send/receive, threaded.",
	},
	{
		name: "email me",
		cmd: "email_me",
		desc: "email yourself right now, or schedule it for a future timestamp. a reminder tool for a process that can't wait around.",
	},
	{
		name: "file sharing",
		cmd: "create_file",
		desc: "upload a file, get back a public url. screenshots, reports, logs &mdash; anything an agent can't host on its own.",
	},
];

export function landingPage(origin: string): Response {
	const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>headlesstools</title>
<meta name="description" content="CLI-first, MCP-first SaaS tools for AI agents. URL shortener, pastebin, and a real send/receive mailbox." />
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
  .wrap { max-width: 680px; margin: 0 auto; padding: 0 24px; }
  header.nav {
    border-bottom: 1px solid var(--line);
    padding: 18px 0;
  }
  header.nav .wrap { display: flex; align-items: center; justify-content: space-between; }
  .logo { font-weight: 600; letter-spacing: -0.02em; text-decoration: none; }
  .navlinks a { margin-left: 24px; font-size: 14px; color: var(--dim); text-decoration: none; }
  .navlinks a:hover { color: var(--ink); }

  .hero { padding: 64px 0 32px; }
  .hero h1 { font-size: 34px; line-height: 1.25; margin: 0 0 14px; letter-spacing: -0.02em; }
  .hero p { font-size: 16px; color: var(--dim); max-width: 560px; margin: 0 0 0; line-height: 1.6; }

  .terminal {
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
    margin: 32px 0 56px;
  }
  .terminal .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
    background: #f5f5f4;
  }
  .terminal .dot { width: 9px; height: 9px; border-radius: 50%; background: #d9d9d9; display: inline-block; }
  .terminal .bar-label { margin-left: 8px; font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
  .terminal .body {
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.7;
    padding: 18px 20px;
    min-height: 230px;
  }
  .term-line { white-space: pre-wrap; word-break: break-word; margin-bottom: 10px; }
  .term-line.user { background: #f5f5f4; margin: 0 -20px 10px; padding: 6px 20px; }
  .term-line .prompt { margin-right: 8px; }
  .term-line.user .prompt { color: var(--dim); }
  .term-line.assistant .prompt { color: var(--accent); }
  .term-line.tool { color: var(--dim); font-style: italic; font-size: 12.5px; }
  .term-line a { color: #2563eb; text-decoration: underline; }
  .term-cursor {
    display: inline-block;
    width: 7px;
    height: 14px;
    background: var(--ink);
    vertical-align: text-bottom;
    margin-left: 1px;
    animation: term-blink 1s step-end infinite;
  }
  @keyframes term-blink { 50% { opacity: 0; } }

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
    grid-template-columns: repeat(2, 1fr);
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
      <h1>Tools built for agents, not dashboards.</h1>
      <p>A url shortener, a pastebin, and a real mailbox &mdash; each one CLI-first and MCP-first, so an agent can use them like it uses any other tool call.</p>
    </section>

    <div class="terminal">
      <div class="bar">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="bar-label">claude code &middot; headlesstools</span>
      </div>
      <div class="body" id="term-body"></div>
    </div>

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

  <script>
  (function () {
    var body = document.getElementById("term-body");
    if (!body) return;

    var script = [
      { type: "user", text: "can you shorten this url for me https://blog.cloudflare.com/task-based-oauth-consent/" },
      { type: "tool", text: "Called headlesstools" },
      { type: "assistant", text: "Here's your shortened url: ${origin}/c93ba" },
      { type: "user", text: 'can you email me in 1 hour saying "reminder to check that blog post"' },
      { type: "tool", text: "Called headlesstools" },
      { type: "assistant", text: "Scheduled — an email will go to fayaz@acme.org in 1 hour." },
    ];

    function linkify(text) {
      return text
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')
        .replace(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi, '<a href="mailto:$1">$1</a>');
    }

    function sleep(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }

    function typeInto(el, text, speed) {
      return new Promise(function (resolve) {
        var cursor = document.createElement("span");
        cursor.className = "term-cursor";
        var textNode = document.createTextNode("");
        el.appendChild(textNode);
        el.appendChild(cursor);
        var i = 0;
        (function tick() {
          if (i <= text.length) {
            textNode.textContent = text.slice(0, i);
            i++;
            setTimeout(tick, speed);
          } else {
            cursor.remove();
            resolve();
          }
        })();
      });
    }

    async function play() {
      body.innerHTML = "";
      for (var idx = 0; idx < script.length; idx++) {
        var line = script[idx];
        var div = document.createElement("div");
        div.className = "term-line " + line.type;

        if (line.type === "user") {
          var prompt = document.createElement("span");
          prompt.className = "prompt";
          prompt.textContent = "❯";
          div.appendChild(prompt);
          body.appendChild(div);
          await typeInto(div, line.text, 22);
          await sleep(500);
        } else if (line.type === "tool") {
          div.textContent = line.text;
          body.appendChild(div);
          await sleep(700);
        } else {
          var bullet = document.createElement("span");
          bullet.className = "prompt";
          bullet.textContent = "●";
          div.appendChild(bullet);
          body.appendChild(div);
          await typeInto(div, line.text, 14);
          div.innerHTML = '<span class="prompt">●</span>' + linkify(line.text);
          await sleep(1400);
        }
      }
      await sleep(3000);
      play();
    }

    if ("IntersectionObserver" in window) {
      var started = false;
      var obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !started) {
          started = true;
          play();
          obs.disconnect();
        }
      });
      obs.observe(body);
    } else {
      play();
    }
  })();
  </script>
</body>
</html>`;

	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
