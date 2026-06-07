# orry-context-server

The Orry Mill **context server** — a small remote MCP server that fronts the
`orry-context` Supabase database and exposes a few safe, named tools to Claude.
It is the only thing that talks to the database; Claude (Stephen's and Thilde's
accounts, and later automated agents) calls the tools, never the database
directly.

There is **no UI** — Next.js is used purely as the deployment shell for one API route.

## Quick start

```bash
npx create-next-app@latest .        # TS yes, App Router yes, src/ no, Tailwind no, alias @/* yes
npm install mcp-handler @modelcontextprotocol/sdk@1.26.0 zod @supabase/supabase-js
cp .env.example .env.local          # then paste your SUPABASE_SERVICE_ROLE_KEY into .env.local
npm run dev
npx @modelcontextprotocol/inspector # connect to http://localhost:3000/api/mcp
```

## Layout

```
app/api/[transport]/route.ts   the MCP server + tools
lib/supabase.ts                server-side Supabase client (service role)
.env.local                     secrets — LOCAL ONLY, never committed
CLAUDE.md                      context & build brief for Claude Code
```

## Tools

- `get_context({ key?, type? })` — read active context entries.
- `upsert_context({ key, title, body, type, tags, updated_by })` — create/update by key.

See `CLAUDE.md` for the architecture, conventions, and what is in/out of scope right now.
