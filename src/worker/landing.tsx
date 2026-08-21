import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import landingCss from "./landing.css?inline";

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
    desc: "get a real email address on demand - read otps and webhooks, and send replies too. full send/receive, threaded.",
  },
  {
    name: "email me",
    cmd: "email_me",
    desc: "email yourself right now, or schedule it for a future timestamp. a reminder tool for a process that can't wait around.",
  },
  {
    name: "file sharing",
    cmd: "create_file",
    desc: "upload a file, get back a public url. screenshots, reports, logs - anything an agent can't host on its own.",
  },
];

function terminalScript(origin: string) {
  return `
  (function () {
    var body = document.getElementById("term-body");
    if (!body) return;

    var script = [
      { type: "user", text: "can you shorten this url for me blog.cloudflare.com/task-based-oauth-consent" },
      { type: "tool", text: "Called headlesstools" },
      { type: "assistant", text: "Here's your shortened url: ${origin}/c93ba" },
      { type: "user", text: 'can you email me in 1 hour saying "reminder to check that blog post"' },
      { type: "tool", text: "Called headlesstools" },
      { type: "assistant", text: "Scheduled - an email will go to fayaz@acme.org in 1 hour." },
      { type: "user", text: "how many clicks does that url have?" },
      { type: "tool", text: "Called headlesstools" },
      { type: "assistant", text: "788 clicks so far." },
      { type: "user", text: "can you upload this and give me a link [Image #1]" },
      { type: "tool", text: "Called headlesstools" },
      { type: "assistant", text: "Uploaded - here's your file: ${origin}/f/8h3kq" },
    ];

    function linkify(text) {
      return text
        .replace(/(https?:\\/\\/[^\\s]+)/g, '<a href="$1">$1</a>')
        .replace(/([\\w.+-]+@[\\w.-]+\\.[a-z]{2,})/gi, '<a href="mailto:$1">$1</a>');
    }

    function sleep(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }

    function scrollToBottom() {
      body.scrollTop = body.scrollHeight;
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
            scrollToBottom();
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
          scrollToBottom();
          await typeInto(div, line.text, 22);
          await sleep(500);
        } else if (line.type === "tool") {
          div.textContent = line.text;
          body.appendChild(div);
          scrollToBottom();
          await sleep(700);
        } else {
          var bullet = document.createElement("span");
          bullet.className = "prompt";
          bullet.textContent = "●";
          div.appendChild(bullet);
          body.appendChild(div);
          scrollToBottom();
          await typeInto(div, line.text, 14);
          div.innerHTML = '<span class="prompt">●</span>' + linkify(line.text);
          scrollToBottom();
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
  `;
}

function Page({ origin }: { origin: string }) {
  return (
    <div class="wrap mx-auto max-w-3xl px-6">
      <header class="nav border-b border-line py-[18px]">
        <div class="flex items-center justify-between">
          <a class="text-base font-semibold tracking-[-0.02em] flex gap-1" href="/">
            <svg class="h-5 w-auto mb-1" width="110" height="111" viewBox="0 0 110 111" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 55C0 24.6244 24.6243 0 55 0C85.3757 0 110 24.6243 110 55V106.452C110 108.589 108.267 110.323 106.129 110.323H3.87096C1.73309 110.323 0 108.589 0 106.452V55Z" fill="currentColor" />
            </svg>
            <span>

              headlesstools
            </span>
          </a>
          <nav>
            <a class="ml-6 text-sm text-dim hover:text-ink" href="#features">
              features
            </a>
            <a class="ml-6 text-sm text-dim hover:text-ink" href="#docs">
              docs
            </a>
          </nav>
        </div>
      </header>

      <section class="pt-16 pb-8">
        <h1 class="mb-3.5 text-[26px] leading-[1.25] tracking-[-0.02em] sm:text-[34px]">
          Tools built for agents, not dashboards.
        </h1>
        <p class="text-pretty leading-[1.6] text-dim">
          Tools you need where you work everyday.
        </p>
        <p class="text-pretty leading-[1.6] text-dim mt-4">
          A URL Shortener, a Pastebin, Mailbox, Self reminder, and file uploading and sharing primitives right inside Claude Code, Codex, Open Code or any harness that supports MCPs.
        </p>
      </section>

      <div class="my-8 mb-14 overflow-hidden rounded-lg border border-line bg-white">
        <div class="flex items-center gap-1.5 border-b border-line bg-[#f5f5f4] px-3.5 py-2.5">
          <span class="inline-block size-2.25 rounded-full bg-line" />
          <span class="inline-block size-2.25 rounded-full bg-line" />
          <span class="inline-block size-2.25 rounded-full bg-line" />
          <span class="ml-2 font-mono text-[11.5px] text-dim">claude code · headlesstools</span>
        </div>
        <div
          id="term-body"
          class="h-[230px] overflow-y-hidden scroll-smooth px-5 py-4.5 font-mono text-[13px] leading-[1.7] [&_a]:text-[#2563eb] [&_a]:underline [&_.prompt]:mr-2 [&_.term-cursor]:ml-px [&_.term-cursor]:inline-block [&_.term-cursor]:h-3.5 [&_.term-cursor]:w-[7px] [&_.term-cursor]:animate-[term-blink_1s_step-end_infinite] [&_.term-cursor]:bg-ink [&_.term-cursor]:align-text-bottom [&_.term-line]:mb-2.5 [&_.term-line]:break-words [&_.term-line]:whitespace-pre-wrap [&_.term-line.assistant_.prompt]:text-accent [&_.term-line.tool]:text-[12.5px] [&_.term-line.tool]:text-dim [&_.term-line.tool]:italic [&_.term-line.user]:-mx-5 [&_.term-line.user]:bg-[#f5f5f4] [&_.term-line.user]:px-5 [&_.term-line.user]:py-1.5 [&_.term-line.user_.prompt]:text-dim"
        />
      </div>

      <section id="features" class="mb-16">
        <h2 class="mb-[18px] font-mono text-xs tracking-[0.08em] text-dim uppercase">features</h2>
        <div class="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div class="bg-white p-[22px]" key={f.cmd}>
              <span class="mb-1.5 block font-semibold">{f.name}</span>
              <span class="mb-2.5 block font-mono text-[11.5px] text-accent">{f.cmd}()</span>
              <p class="text-[13.5px] leading-[1.55] text-dim">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="docs" class="mb-16">
        <h2 class="mb-[18px] font-mono text-xs tracking-[0.08em] text-dim uppercase">docs</h2>
        <p class="mb-2 text-[13px] text-dim">connect via MCP - opens a browser once, no token to copy</p>

        <h3 class="mt-0 mb-1 text-sm font-semibold">Claude Code</h3>
        <pre class="mb-3.5 overflow-x-auto border border-line bg-white px-[18px] py-4 font-mono text-[13px] leading-[1.6]">
          {`$ claude mcp add --transport http headlesstools \\
    ${origin}/mcp`}
        </pre>

        <h3 class="mt-8 mb-1 text-sm font-semibold">Codex CLI</h3>
        <pre class="mb-3.5 overflow-x-auto border border-line bg-white px-[18px] py-4 font-mono text-[13px] leading-[1.6]">
          {`# ~/.codex/config.toml
[mcp_servers.headlesstools]
url = "${origin}/mcp"

$ codex mcp login headlesstools`}
        </pre>

        <h3 class="mt-8 mb-1 text-sm font-semibold">OpenCode</h3>
        <pre class="mb-3.5 overflow-x-auto border border-line bg-white px-[18px] py-4 font-mono text-[13px] leading-[1.6]">
          {`// opencode.json
{
  "mcp": {
    "headlesstools": {
      "type": "remote",
      "url": "${origin}/mcp"
    }
  }
}`}
        </pre>

        <p class="mb-2 text-[13px] text-dim">or use the REST API directly</p>
        <pre class="mb-3.5 overflow-x-auto border border-line bg-white px-[18px] py-4 font-mono text-[13px] leading-[1.6]">
          {`$ curl -X POST ${origin}/v1/auth/signup -d '{"email":"you@example.com"}'
$ curl -X POST ${origin}/v1/auth/verify -d '{"email":"...","code":"123456"}'
> {"apiKey":"hlt_live_..."}

$ curl -X POST ${origin}/v1/links -H "authorization: Bearer hlt_live_..." \\
    -d '{"url":"https://example.com"}'
$ curl -X POST ${origin}/v1/pastes -H "authorization: Bearer hlt_live_..." \\
    -d '{"content":"hello world"}'
$ curl -X POST ${origin}/v1/inboxes -H "authorization: Bearer hlt_live_..."`}
        </pre>
      </section>

      <footer class="border-t border-line py-6 pb-12 text-[12.5px] text-dim">
        headlesstools - cli-first, mcp-first tools for ai agents
      </footer>

      <script dangerouslySetInnerHTML={{ __html: terminalScript(origin) }} />
    </div>
  );
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  jsxRenderer(({ children }) => (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>headlesstools</title>
        <meta
          name="description"
          content="CLI-first, MCP-first SaaS tools for AI agents. URL shortener, pastebin, and a real send/receive mailbox."
        />
        <style dangerouslySetInnerHTML={{ __html: landingCss }} />
      </head>
      <body class="m-0 bg-bg font-sans text-ink antialiased">{children}</body>
    </html>
  )),
);

app.get("/", (c) => c.render(<Page origin={new URL(c.req.url).origin} />));

export default app;
