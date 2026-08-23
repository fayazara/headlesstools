# headlesstools

Headless tools for AI agents.

Callable as MCP tools or a plain REST API, right from Claude Code, Codex, Cursor, OpenCode, Grok CLI, or any harness that speaks MCP or HTTP.

Sign up at [hdls.tools](https://hdls.tools)



https://github.com/user-attachments/assets/a6846cd4-9524-4a0a-8ca3-4e5464a02f30



## Tools

- **URL shortener** (`shorten_url`) — long URL in, short link out, with click tracking.
- **Pastebin** (`create_paste`) — share text/code snippets with a link. private, unlisted, or burn-after-read.
- **Mailbox** (`create_inbox`) — claim a real `handle@hdls.tools` address. read OTPs and webhooks, send and receive, threaded replies. one per account.
- **Email me** (`email_me`) — email yourself right now, or schedule it for a future timestamp.
- **File sharing** (`create_file`) — upload a file, get back a public URL. up to 10MB.

## Connect via MCP

`/authorize` opens a browser once and completes OAuth — no token to copy.

**Claude Code**

```bash
claude mcp add --transport http headlesstools https://hdls.tools/mcp
```

**Grok CLI**

```bash
grok mcp add --transport http headlesstools https://hdls.tools/mcp
```

**Codex CLI**

```bash
codex mcp add headlesstools --url https://hdls.tools/mcp
codex mcp login headlesstools
```

**Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "headlesstools": { "url": "https://hdls.tools/mcp" }
  }
}
```

**OpenCode**

```bash
opencode mcp add headlesstools --url https://hdls.tools/mcp
opencode mcp auth headlesstools
```

### MCP tools

| Tool | Description |
| --- | --- |
| `shorten_url` | Create a short link for a URL |
| `list_links` | List your short links |
| `create_paste` | Create a paste (text snippet) and get a shareable link |
| `get_paste` | Fetch a paste's content by slug (works for your own private pastes too) |
| `list_pastes` | List your pastes |
| `create_inbox` | Claim your email address by picking a handle. One address per account |
| `send_email` | Send an email from one of your inbox addresses; thread replies via `replyToMessageId` |
| `list_inboxes` | List your email address(es) |
| `list_inbox_messages` | List messages received in an inbox |
| `get_inbox_message` | Fetch the full content of a received email |
| `email_me` | Email the account owner's own verified address, now or at a future time |
| `create_file` | Upload a file (base64-encoded) and get back a public URL. Max 10MB |
| `list_files` | List your uploaded files |
| `delete_file` | Delete an uploaded file |

## REST API

Prefer plain HTTP? Sign up, verify, and use the API key as a bearer token.

```bash
curl -X POST https://hdls.tools/v1/auth/signup -d '{"email":"you@example.com"}'
curl -X POST https://hdls.tools/v1/auth/verify -d '{"email":"...","code":"123456"}'
# => {"apiKey":"hlt_live_..."}

curl -X POST https://hdls.tools/v1/links -H "authorization: Bearer hlt_live_..." \
  -d '{"url":"https://example.com"}'
```

| Resource | Endpoints |
| --- | --- |
| `/v1/auth` | `POST /signup`, `POST /verify`, `GET /keys`, `POST /keys`, `DELETE /keys/:id` |
| `/v1/links` | `POST /`, `GET /`, `GET /:slug`, `DELETE /:slug` |
| `/v1/pastes` | `POST /`, `GET /`, `GET /:slug`, `DELETE /:slug` |
| `/v1/inboxes` | `POST /`, `GET /`, `GET /:id`, `POST /:id/send`, `GET /:id/messages/:messageId`, `DELETE /:id` |
| `/v1/email-me` | `POST /` |
| `/v1/files` | `POST /`, `GET /`, `DELETE /:slug` |

Short links resolve at the bare root (`hdls.tools/:slug`), paste content is served raw at `/p/:slug`, and uploaded files at `/f/:slug`.

The homepage also returns a markdown rendition when requested with `Accept: text/markdown`, for agents that would rather not parse HTML.

## Stack

- [Hono](https://hono.dev/) on [Cloudflare Workers](https://developers.cloudflare.com/workers/) — REST API, MCP server, and the server-rendered (Hono JSX) landing page
- [Drizzle ORM](https://orm.drizzle.team/) over [D1](https://developers.cloudflare.com/d1/)
- [R2](https://developers.cloudflare.com/r2/) for uploaded files
- [Workers KV](https://developers.cloudflare.com/kv/) for OAuth state
- [Email Routing / Send Email](https://developers.cloudflare.com/email-routing/) for the mailbox and reminders
- [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) for MCP OAuth
- [Shiki](https://shiki.style/) for the syntax-highlighted docs blocks
- Tailwind CSS v4

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs on the Cloudflare Vite plugin, which emulates the bindings declared in `wrangler.json` (D1, R2, KV, Email, rate limits) locally.

Apply migrations locally:

```bash
pnpm db:migrate:local
```

After changing `src/db/schema.ts`, generate a new migration:

```bash
pnpm db:generate
```

The IDs in `wrangler.json` (D1 database, R2 bucket, KV namespace, custom domain) point at the author's Cloudflare account. If you fork this repo, swap them for your own (`wrangler d1 create`, `wrangler r2 bucket create`, `wrangler kv namespace create`) and update `INBOX_DOMAIN` to a domain you control with Email Routing enabled.

## Deploy

```bash
pnpm run build
pnpm run deploy
```

`pnpm run check` type-checks, builds, and does a dry-run deploy without publishing.
