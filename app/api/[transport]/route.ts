import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";

// Supabase-js needs the Node runtime (not Edge).
export const runtime = "nodejs";
export const maxDuration = 60;

const handler = (createMcpHandler as any)(
  (server: any) => {
    // READ — fetch active context, optionally filtered by key or type.
    server.tool(
      "get_context",
      "Read Orry Mill brand & business context. Optionally filter by key or type. Returns active entries.",
      {
        key: z.string().optional().describe("Exact entry key, e.g. 'brand-voice'"),
        type: z.string().optional().describe("Filter by type, e.g. 'brand-voice', 'faq'"),
      },
      async ({ key, type }: any) => {
        let q = supabaseAdmin
          .from("context_entries")
          .select("key,title,body,type,tags,updated_at")
          .eq("status", "active")
          .order("type")
          .order("key");
        if (key) q = q.eq("key", key);
        if (type) q = q.eq("type", type);

        const { data, error } = await q;
        if (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // WRITE — create or update an entry by key (upsert).
    if (process.env.MCP_ENABLE_WRITE === "true") {
      server.tool(
        "upsert_context",
        "Create or update an Orry Mill context entry by key (brand voice, FAQs, product facts, etc.).",
        {
          key: z.string().describe("Stable slug, e.g. 'brand-voice'"),
          title: z.string().describe("Human-readable title"),
          body: z.string().describe("The content (markdown / prose)"),
          type: z.string().default("general").describe("brand-voice | product | policy | faq | example | general"),
          tags: z.array(z.string()).default([]).describe("Optional retrieval tags"),
          updated_by: z.string().describe("Who is making the change, e.g. 'stephen' or 'thilde'"),
        },
        async ({ key, title, body, type, tags, updated_by }: any) => {
          const { data, error } = await supabaseAdmin
            .from("context_entries")
            .upsert(
              { key, title, body, type, tags, updated_by, status: "active" },
              { onConflict: "key" }
            )
            .select("key,type,updated_at")
            .single();

          if (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
          }
          return { content: [{ type: "text", text: `Saved '${data.key}' (${data.type}) at ${data.updated_at}` }] };
        }
      );
    }
  },
  { name: "orry-mill-context", version: "0.1.0" },
  { basePath: "/api" }
);

export { handler as GET, handler as POST, handler as DELETE };
