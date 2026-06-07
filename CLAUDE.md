# Orry Mill — Context Server (`orry-context-server`)

Context and build brief for Claude Code working in this repository. Read this fully before making changes.

## What this is

A small remote **MCP server** that sits in front of the Orry Mill context database and exposes a few **safe, named tools** to Claude. Think of it as the clerk at a counter: Claude calls named tools, and this server is the only thing that talks to the database — server-side, with the service-role key. Nothing else reaches the database directly.

It is **not** a UI application. Next.js is used only as the deployment shell for a single API route. There is no front end; the default demo page can be deleted.

## Where it fits (three layers)

- **Clients** — Stephen's Claude and Thilde's Claude (two separate Pro/Max accounts), connected via one authenticated custom connector. Later, automated agents (a Shopify chatbot, etc.) call the same server.
- **This server** — runs on Vercel; exposes the tools; holds the Supabase key.
- **Supabase** (`orry-context`, region `eu-west-1`) — where the data lives.

Design principle: the **tools are the contract**. Storage stays behind the server so it can change without breaking callers, and so no caller ever needs database access.

## Stack (pinned)

- Next.js (App Router) + TypeScript — deployment shell only, no UI
- `mcp-handler` — Vercel's MCP adapter (Streamable HTTP transport)
- `@modelcontextprotocol/sdk@1.26.0` — **pin to 1.26.0 or later** (earlier versions carry a security fix)
- `zod@^3` — tool input validation
- `@supabase/supabase-js@^2` — database client
- Node 20+. Deploy via `git push` (Vercel builds from GitHub).

## Target structure

```
orry-context-server/
├── CLAUDE.md                      ← this file
├── README.md
├── .env.local                     ← secrets, LOCAL ONLY, never committed
├── .env.example                   ← documents required vars (no values)
├── app/
│   └── api/
│       └── [transport]/
│           └── route.ts           ← the MCP server: tools live here
├── lib/
│   └── supabase.ts                ← server-side Supabase client (service role)
└── (Next.js scaffold: package.json, tsconfig.json, next.config, .gitignore, …)
```

The starter implementations of `app/api/[transport]/route.ts`, `lib/supabase.ts`, and `.env.example` are already in this repo — read them rather than rewriting from scratch.

## Scaffolding (do this first if not already done)

Scaffold with create-next-app, answering: **TypeScript yes · App Router yes · `src/` directory NO · Tailwind no · import alias `@/*` yes** (ESLint optional). The `src/` answer matters — keeping `app/` and `lib/` at the project root is what makes the `@/lib/supabase` import resolve correctly.

```bash
npx create-next-app@latest .
npm install mcp-handler @modelcontextprotocol/sdk@1.26.0 zod @supabase/supabase-js
```

Then ensure the two starter files are in place and copy `.env.example` to `.env.local`, pasting the real `SUPABASE_SERVICE_ROLE_KEY` (from the Supabase dashboard) into `.env.local` only.

## The database (already created — do not recreate)

Table `public.context_entries` already exists:

| column | type | notes |
|---|---|---|
| id | uuid | pk, default `gen_random_uuid()` |
| key | text | unique slug, e.g. `brand-voice` (used for upsert) |
| title | text | human-readable title |
| body | text | markdown / prose content |
| type | text | `brand-voice` \| `product` \| `policy` \| `faq` \| `example` \| `general` |
| tags | text[] | optional retrieval tags |
| status | text | `active` \| `archived` (soft delete; never hard-delete) |
| updated_by | text | who/what last wrote |
| created_at / updated_at | timestamptz | `updated_at` maintained by a trigger |

RLS is **enabled with no policies**, so only the service-role key (used by this server) can reach the table. Do not add public RLS policies, and do not run schema migrations from here.

## Tools (current scope — keep to exactly these two)

- `get_context({ key?, type? })` — read active entries, optionally filtered. Read-only.
- `upsert_context({ key, title, body, type, tags, updated_by })` — create or update an entry by `key`. Write.

## Conventions & hard rules

- **Secrets**: only in `.env.local` (gitignored) locally, and in Vercel's dashboard env vars in production. NEVER commit secrets. NEVER place the service-role key in any client-reachable code.
- **Only safe, named tools.** Never expose a raw-SQL or arbitrary-query tool — callers must not be able to reach the database directly. That is the entire point of this server.
- **Transport**: Streamable HTTP (Claude uses it). SSE is not needed — do not add a Redis dependency. If a Redis URL is requested, disable SSE instead.
- **No hard deletes** — archive via `status = 'archived'`.
- UK English in any human-facing strings.

## Scope: build this now, not more

**Now (Step 3):** get the two tools working **locally** against Supabase, tested with the MCP Inspector. That is the whole job for this step.

**Do NOT yet:**
- Implement authentication / OAuth — that is a separate step (3b), handled before the server ever goes public. Local dev runs without auth, which is normal.
- Deploy to Vercel — that is Step 4, after local works.
- Add more tools (e.g. reading marketing-analytics outputs) — that comes later, once the spine is proven.

Keep it minimal: one clean read and one clean write against Supabase, working locally. Do not "boil the ocean."

## Run & test locally

```bash
npm run dev
npx @modelcontextprotocol/inspector
```

In the Inspector, connect to `http://localhost:3000/api/mcp` (Streamable HTTP). You should see both tools. Then:

1. Call `get_context` → expect an empty list (nothing is seeded yet — correct).
2. Call `upsert_context` with a test entry: `key: brand-voice`, a `title`, a line of `body`, `type: brand-voice`, `updated_by: stephen`.
3. Call `get_context` again → the entry should come back.
4. Confirm the row exists in the Supabase table editor.

That round trip proves the spine end to end: tool call → server → Supabase, read and write. Stop there and report back.
