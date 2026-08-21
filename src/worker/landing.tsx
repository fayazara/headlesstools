import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import landingCss from "./landing.css?inline";
import { highlightCode, type DocLang } from "./lib/highlight";
import { prefersMarkdown } from "./lib/accept";

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
    desc: "pick a handle, get a real email address - read otps and webhooks, and send replies too. one per account, full send/receive, threaded.",
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

// single source of truth for every doc snippet, shared by the highlighted
// HTML code blocks below and the text/markdown rendition of the same page
const DOC_SNIPPETS = {
  claude: (origin: string) => `claude mcp add --transport http headlesstools ${origin}/mcp`,
  grok: (origin: string) => `grok mcp add --transport http headlesstools ${origin}/mcp`,
  codex: (origin: string) => `codex mcp add headlesstools --url ${origin}/mcp\ncodex mcp login headlesstools`,
  cursor: (origin: string) =>
    `{\n  "mcpServers": {\n    "headlesstools": {\n      "url": "${origin}/mcp"\n    }\n  }\n}`,
  opencode: (origin: string) => `opencode mcp add headlesstools --url ${origin}/mcp\nopencode mcp auth headlesstools`,
  rest: (origin: string) => `curl -X POST ${origin}/v1/auth/signup -d '{"email":"you@example.com"}'
curl -X POST ${origin}/v1/auth/verify -d '{"email":"...","code":"123456"}'
# => {"apiKey":"hlt_live_..."}

curl -X POST ${origin}/v1/links -H "authorization: Bearer hlt_live_..." \\
  -d '{"url":"https://example.com"}'
curl -X POST ${origin}/v1/pastes -H "authorization: Bearer hlt_live_..." \\
  -d '{"content":"hello world"}'
curl -X POST ${origin}/v1/inboxes -H "authorization: Bearer hlt_live_..." \\
  -d '{"handle":"acme-bot"}'`,
};

function renderMarkdown(origin: string): string {
  const features = FEATURES.map((f) => `- **${f.name}** — \`${f.cmd}()\` — ${f.desc}`).join("\n");

  return `# headlesstools

MCP-first SaaS tools for AI agents.

Tools you need where you work everyday.

A URL Shortener, a Pastebin, Mailbox, Self reminder, and file uploading and sharing primitives right inside Claude Code, Codex, Open Code or any harness that supports MCPs.

## Features

${features}

## Docs

Connect via MCP - opens a browser once, no token to copy.

### Claude Code

\`\`\`bash
${DOC_SNIPPETS.claude(origin)}
\`\`\`

### Grok CLI

\`\`\`bash
${DOC_SNIPPETS.grok(origin)}
\`\`\`

### Codex CLI

\`\`\`bash
${DOC_SNIPPETS.codex(origin)}
\`\`\`

### Cursor

\`.cursor/mcp.json\`

\`\`\`json
${DOC_SNIPPETS.cursor(origin)}
\`\`\`

### OpenCode

\`\`\`bash
${DOC_SNIPPETS.opencode(origin)}
\`\`\`

Or use the REST API directly:

\`\`\`bash
${DOC_SNIPPETS.rest(origin)}
\`\`\`

---

headlesstools - mcp-first tools for ai agents
`;
}

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

const copyScript = `
(function () {
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".copy-btn");
    if (!btn) return;
    var target = document.getElementById(btn.getAttribute("data-copy-for"));
    if (!target || !navigator.clipboard) return;
    navigator.clipboard.writeText(target.textContent || "").then(function () {
      btn.setAttribute("data-copied", "true");
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(function () {
        btn.removeAttribute("data-copied");
      }, 1600);
    });
  });
})();
`;

async function CodeBlock({
  id,
  code,
  lang,
  title = "terminal",
}: {
  id: string;
  code: string;
  lang: DocLang;
  title?: string;
}) {
  const html = await highlightCode(code.trim(), lang);
  return (
    <div class="code-block mb-3.5">
      <div class="code-block-header">
        <span class="code-block-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span class="code-block-title">{title}</span>
        <button type="button" class="copy-btn" data-copy-for={id} aria-label="Copy to clipboard">
          <svg
            class="icon-copy"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <svg
            class="icon-check"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </button>
      </div>
      <div id={id} class="code-block-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

async function Page({ origin }: { origin: string }) {
  return (
    <div class="wrap mx-auto max-w-3xl px-6">
      <header class="nav pt-8 pb-4 border-b border-neutral-200">
        <div class="flex items-center justify-between">
          <a class="text-base font-semibold tracking-[-0.02em] flex gap-1" href="/">
            <svg class="h-4.5 w-auto" width="110" height="111" viewBox="0 0 110 111" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 55C0 24.6244 24.6243 0 55 0C85.3757 0 110 24.6243 110 55V106.452C110 108.589 108.267 110.323 106.129 110.323H3.87096C1.73309 110.323 0 108.589 0 106.452V55Z" fill="currentColor" />
            </svg>
            <span>

              headlesstools
            </span>
          </a>
          <nav class="flex items-center">
            <a class="ml-6 text-sm text-dim transition-colors hover:text-ink" href="#features">
              features
            </a>
            <a class="ml-6 text-sm text-dim transition-colors hover:text-ink" href="#docs">
              docs
            </a>
            <a
              class="ml-6 text-sm text-dim transition-colors hover:text-ink"
              href="https://github.com/fayazara/headlesstools"
              target="_blank"
              rel="noreferrer"
            >
              github
            </a>
          </nav>
        </div>
      </header>

      <section class="pt-16 pb-8">
        <h1 class="text-balance mb-3.5 text-[26px] leading-[1.25] tracking-[-0.02em] sm:text-[34px] font-medium">
          Tools for agents
        </h1>
        <p class="text-pretty leading-[1.6] text-dim">
          Tools you need where you work everyday.
        </p>
        <p class="text-pretty leading-[1.6] text-dim mt-4">
          A URL Shortener, a Pastebin, Mailbox, Self reminder, and file uploading and sharing primitives right inside Claude Code, Codex, Open Code or any harness that supports MCPs.
        </p>
        <div className="mt-8">
          <p>Works with</p>
          <div className="flex items-center gap-2 mt-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="#d97757" d="m7.5 20.61l5.5-3.08l.1-.27l-.1-.15h-.27l-.92-.06a234 234 0 0 1-8.51-.34l-.67-.14l-.62-.82l.06-.41l.56-.38l.8.07c3.08.2 6.15.4 9.21.72h.46l.06-.19l-.16-.1l-.12-.12l-2.74-1.86c-2.04-1.3-3.55-2.43-5.38-3.68l-.43-.54l-.18-1.18l.76-.84l1.03.07l.26.07c2.03 1.6 4.1 3.14 6.17 4.66l.43.36l.17-.12l.02-.09l-.2-.32c-1.43-2.6-2.55-4.62-4-6.96l-.2-.72c-.08-.3-.13-.55-.13-.85l.87-1.18l.49-.16l1.16.16l.49.42c1.4 3.31 2.76 5.93 4.23 8.83l.29.97l.1.3h.19v-.17c.65-3.42 0-6.57 1.22-9.53l.87-.57l.68.33l.56.8l-.08.51c-.37 2.62-.92 5.22-1.4 7.82h.24l.29-.29a69 69 0 0 1 4.91-5.94l.64-.5h1.2l.89 1.32l-.4 1.36a53.5 53.5 0 0 0-4.66 6.47l.09.13l.22-.02c2.4-.57 4.84-.99 7.27-1.4l.97.45l.1.46l-.37.94c-3 .72-6 1.34-9 2.05l-.05.04l.06.07c2.7.26 5.62.3 7.99.47l.92.61l.55.75l-.1.56l-1.4.73c-2.93-.7-5.19-1.22-7.91-1.9h-.22v.13c2.18 2.12 4.6 4.27 6.54 6.07l.15.68l-.38.53l-.4-.06c-2.04-1.43-3.9-3.09-5.8-4.7h-.15v.2l.52.76c1.14 1.79 2.64 3.25 2.87 5.37l-.2.41l-.7.25l-.78-.14a73 73 0 0 1-4.58-7.04l-.17.09l-.78 8.46l-.37.43l-.85.33l-.71-.54l-.38-.87a114 114 0 0 0 1.53-7.97l.2-.73l-.01-.05l-.16.02a77 77 0 0 1-6.23 7.88l-.48.2l-.84-.44l.08-.77l.47-.69c2.07-2.57 3.54-4.66 5.54-7v-.19h-.07l-7.4 4.8l-1.31.17l-.57-.53l.07-.87l.27-.28l2.23-1.53z" /></svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M20.57 10.18c.45-1.36.3-2.85-.43-4.09a5.03 5.03 0 0 0-5.42-2.42a5.05 5.05 0 0 0-7.14-.38c-.66.59-1.15 1.35-1.43 2.19A4.98 4.98 0 0 0 2.82 7.9c-1.1 1.9-.85 4.29.62 5.91c-.45 1.36-.3 2.85.43 4.09a5.045 5.045 0 0 0 5.43 2.42A5.03 5.03 0 0 0 13.06 22c2.19 0 4.14-1.41 4.81-3.5a4.98 4.98 0 0 0 3.33-2.42a5.04 5.04 0 0 0-.62-5.89Zm-7.52 10.51c-.88 0-1.72-.31-2.4-.87l.12-.07l3.98-2.3c.2-.12.33-.33.33-.57v-5.61l1.68.97s.03.02.03.04v4.65c0 2.07-1.68 3.74-3.75 3.75ZM5 17.25c-.44-.76-.6-1.65-.45-2.51l.12.07l3.99 2.3c.2.12.45.12.65 0l4.87-2.81v1.94s-.01.04-.03.05l-4.03 2.33A3.756 3.756 0 0 1 5 17.25M3.95 8.58a3.7 3.7 0 0 1 1.97-1.64v4.73c0 .23.12.45.32.56l4.85 2.8l-1.68.97h-.06l-4.03-2.32a3.754 3.754 0 0 1-1.37-5.12zm13.83 3.21l-4.86-2.82L14.6 8h.06l4.03 2.33a3.743 3.743 0 0 1 1.37 5.12a3.8 3.8 0 0 1-1.94 1.64v-4.73a.67.67 0 0 0-.34-.56Zm1.68-2.52l-.12-.07l-3.98-2.32a.63.63 0 0 0-.65 0L9.84 9.69V7.75s0-.04.02-.05l4.03-2.32a3.75 3.75 0 0 1 5.12 1.38c.44.76.59 1.64.45 2.51v.02ZM8.93 12.72l-1.68-.97s-.03-.03-.03-.05V7.06c0-2.07 1.68-3.75 3.75-3.74c.87 0 1.72.31 2.39.87l-.12.07l-3.98 2.3c-.2.12-.33.33-.33.57v5.6Zm.91-1.97l2.17-1.25l2.17 1.25v2.5l-2.16 1.25l-2.17-1.25v-2.5Z" /></svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none"><g clip-path="url(#SVGeP5Myl1x)" transform="translate(4.8 2)scale(.09333)"><mask id="SVG6J7nseBa" width="240" height="300" x="0" y="0" maskUnits="userSpaceOnUse"><path fill="#fff" d="M240 0H0v300h240z" /></mask><g mask="url(#SVG6J7nseBa)"><path fill="#cfcecd" d="M180 240H60V120h120z" /><path fill="#211e1e" d="M180 60H60v180h120zm60 240H0V0h240z" /></g></g><defs><clipPath id="SVGeP5Myl1x"><path fill="#fff" d="M0 0h240v300H0z" /></clipPath></defs></g></svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M4.94 4.96a9.97 9.97 0 0 1 10.835-2.182a8.7 8.7 0 0 1 2.033 1.11l-3.006 1.39C12.003 4.101 8.797 4.9 6.84 6.86c-2.564 2.565-3.146 6.954-.36 9.922l.278.284L.124 23c1.875-1.973 3.771-4.427 2.636-7.19c-1.52-3.698-.635-8.03 2.18-10.85M23.9.1c-2.264 3.174-3.184 5.389-2.197 9.64l-.007-.007c.753 3.201-.052 6.75-2.653 9.355c-3.279 3.285-8.526 4.016-12.847 1.06L9.21 18.75c2.758 1.084 5.775.607 7.943-1.564c2.169-2.17 2.655-5.332 1.566-7.963c-.207-.5-.828-.625-1.263-.304L8.59 15.472l12.7-12.77v.01z" /></svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M21.121 6.33L12.45 1.353a.9.9 0 0 0-.9 0L2.879 6.33a.75.75 0 0 0-.379.652v10.036c0 .27.144.518.379.652l8.671 4.977c.278.16.622.16.9 0l8.672-4.977a.75.75 0 0 0 .378-.652V6.982a.75.75 0 0 0-.379-.652m-.544 1.054l-8.371 14.414c-.057.097-.206.057-.206-.055v-9.438a.53.53 0 0 0-.266-.458L3.512 7.128c-.097-.056-.057-.204.056-.204H20.31c.237 0 .386.256.267.46" /></svg>
          </div>
        </div>
      </section>

      <div class="term-window mt-4 mb-14 overflow-hidden rounded-lg border border-line bg-white">
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
            <div class="feature-card bg-white p-[22px]" key={f.cmd}>
              <span class="mb-1.5 block font-semibold">{f.name}</span>
              <span class="feature-cmd mb-2.5 block font-mono text-[11.5px] text-accent transition-colors">{f.cmd}()</span>
              <p class="text-[13.5px] leading-[1.55] text-dim">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="docs" class="mb-16">
        <h2 class="mb-[18px] font-mono text-xs tracking-[0.08em] text-dim uppercase">docs</h2>
        <p class="mb-2 text-[13px] text-dim">connect via MCP - opens a browser once, no token to copy</p>

        <h3 class="mt-0 mb-1 text-sm font-semibold">Claude Code</h3>
        <CodeBlock id="code-claude" lang="bash" code={DOC_SNIPPETS.claude(origin)} />

        <h3 class="mt-8 mb-1 text-sm font-semibold">Grok CLI</h3>
        <CodeBlock id="code-grok" lang="bash" code={DOC_SNIPPETS.grok(origin)} />

        <h3 class="mt-8 mb-1 text-sm font-semibold">Codex CLI</h3>
        <CodeBlock id="code-codex" lang="bash" code={DOC_SNIPPETS.codex(origin)} />

        <h3 class="mt-8 mb-1 text-sm font-semibold">Cursor</h3>
        <CodeBlock id="code-cursor" lang="json" title=".cursor/mcp.json" code={DOC_SNIPPETS.cursor(origin)} />

        <h3 class="mt-8 mb-1 text-sm font-semibold">OpenCode</h3>
        <CodeBlock id="code-opencode" lang="bash" code={DOC_SNIPPETS.opencode(origin)} />

        <p class="mb-2 text-[13px] text-dim">or use the REST API directly</p>
        <CodeBlock id="code-rest" lang="bash" code={DOC_SNIPPETS.rest(origin)} />
      </section>

      <footer class="border-t border-line py-6 pb-12 text-[12.5px] text-dim">
        headlesstools - mcp-first tools for ai agents
      </footer>

      <script dangerouslySetInnerHTML={{ __html: terminalScript(origin) }} />
      <script dangerouslySetInnerHTML={{ __html: copyScript }} />
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
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
        <title>headlesstools</title>
        <meta
          name="description"
          content="MCP-first SaaS tools for AI agents. URL shortener, pastebin, and a real send/receive mailbox."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap"
        />
        <style dangerouslySetInnerHTML={{ __html: landingCss }} />
      </head>
      <body class="m-0 bg-bg font-sans text-ink antialiased">{children}</body>
    </html>
  )),
);

app.get("/", (c) => {
  const origin = new URL(c.req.url).origin;
  if (prefersMarkdown(c.req.header("accept"))) {
    return c.body(renderMarkdown(origin), 200, { "content-type": "text/markdown; charset=utf-8" });
  }
  return c.render(<Page origin={origin} />);
});

export default app;
