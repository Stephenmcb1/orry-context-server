#!/usr/bin/env node
// scripts/seed-context.mjs
//
// Seeds public.context_entries in the orry-context Supabase project from the
// modular markdown files in content/. Idempotent: upserts by `key`, never
// hard-deletes. Re-runnable and version-controlled — the markdown stays the
// initial source of truth; Context Studio becomes the ongoing write path later.
//
// Usage (Node >= 20.6 for --env-file):
//   node --env-file=.env.local scripts/seed-context.mjs            # write
//   node --env-file=.env.local scripts/seed-context.mjs --dry-run  # preview, no writes
//   node --env-file=.env.local scripts/seed-context.mjs --dir docs # point at another dir
//
// On Node < 20.6, either `npm i -D dotenv` and add `import 'dotenv/config'`
// at the top, or export the two vars into the environment yourself.
//
// Each .md file becomes one row:
//   key        <- frontmatter `key:`        else filename stem (brand-voice.md -> brand-voice)
//   title      <- frontmatter `title:`      else first "# H1"   else humanised stem
//   type       <- frontmatter `type:`       else DEFAULT_TYPE[stem] else FALLBACK_TYPE
//   tags       <- frontmatter `tags: [a,b]` else []
//   body       <- markdown content (frontmatter stripped)
//   status     <- always 'active' for seeded entries
//   updated_by <- 'seed-script'

import { readdir, readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const dirIdx = process.argv.indexOf('--dir');
const CONTENT_DIR = dirIdx !== -1 ? process.argv[dirIdx + 1] : 'content';
const UPDATED_BY = 'seed-script';

// Default type per filename stem. Frontmatter `type:` overrides. Edit to taste —
// this taxonomy is what get_context({ type }) filters on, so keep it deliberate.
const DEFAULT_TYPE = {
  'brand-voice': 'brand',
  'orry-yarn': 'product',
  'products': 'product',
  'policies': 'policy',
  'faqs': 'faq',
};
const FALLBACK_TYPE = 'general';

// --- minimal, dependency-free frontmatter parser --------------------------
// Handles a leading `---` ... `---` block with `key: value` lines and
// `tags: [a, b]`. For anything richer, swap in gray-matter.
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw.trim() };
  const [, fm, body] = m;
  const data = {};
  for (const line of fm.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (k === 'tags') {
      v = v.replace(/^\[|\]$/g, '');
      data.tags = v
        ? v.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : [];
    } else {
      data[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: body.trim() };
}

const humanise = (stem) =>
  stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const firstH1 = (body) => {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
};

function toEntry(filename, raw) {
  const stem = basename(filename, extname(filename));
  const { data, body } = parseFrontmatter(raw);
  return {
    key: (data.key || stem).trim(),
    title: (data.title || firstH1(body) || humanise(stem)).trim(),
    body,
    type: (data.type || DEFAULT_TYPE[stem] || FALLBACK_TYPE).trim(),
    tags: Array.isArray(data.tags) ? data.tags : [],
    status: 'active',
    updated_by: UPDATED_BY,
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Load .env.local, e.g. `node --env-file=.env.local scripts/seed-context.mjs`.'
    );
    process.exit(1);
  }

  let files;
  try {
    files = (await readdir(CONTENT_DIR))
      .filter((f) => extname(f).toLowerCase() === '.md')
      .sort();
  } catch (err) {
    console.error(`Could not read content dir "${CONTENT_DIR}": ${err.message}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No .md files found in "${CONTENT_DIR}".`);
    process.exit(1);
  }

  const entries = [];
  for (const f of files) {
    const raw = await readFile(join(CONTENT_DIR, f), 'utf8');
    const entry = toEntry(f, raw);
    if (!entry.body) {
      console.warn(`! ${f}: empty body after frontmatter — skipping.`);
      continue;
    }
    entries.push({ file: f, ...entry });
  }
  if (entries.length === 0) {
    console.error('Nothing to seed after parsing.');
    process.exit(1);
  }

  // Guard: duplicate keys across files would clobber each other on upsert.
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.key)) {
      console.error(
        `Duplicate key "${e.key}" in ${e.file} and ${seen.get(e.key)}. Fix before seeding.`
      );
      process.exit(1);
    }
    seen.set(e.key, e.file);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Pre-read existing keys purely for create/update logging.
  const keys = entries.map((e) => e.key);
  const { data: existingRows, error: selErr } = await supabase
    .from('context_entries')
    .select('key')
    .in('key', keys);
  if (selErr) {
    console.error(`Could not read existing keys: ${selErr.message}`);
    process.exit(1);
  }
  const existing = new Set((existingRows || []).map((r) => r.key));

  console.log(
    `\n${DRY_RUN ? 'DRY RUN — ' : ''}Seeding ${entries.length} entr${
      entries.length === 1 ? 'y' : 'ies'
    } from "${CONTENT_DIR}/" into context_entries:\n`
  );
  for (const e of entries) {
    const action = existing.has(e.key) ? 'update' : 'create';
    console.log(
      `  ${action.padEnd(6)} ${e.key.padEnd(16)} type=${e.type.padEnd(8)} ` +
        `tags=[${e.tags.join(', ')}]  ${e.body.length} chars  <- ${e.file}`
    );
  }

  if (DRY_RUN) {
    console.log('\nDry run complete — nothing written.\n');
    return;
  }

  // Upsert by key. Only listed columns are written, so created_at is preserved
  // on update. Drop updated_at below if a DB trigger already manages it.
  const now = new Date().toISOString();
  const payload = entries.map(({ file, ...row }) => ({ ...row, updated_at: now }));
  const { error: upErr } = await supabase
    .from('context_entries')
    .upsert(payload, { onConflict: 'key' });
  if (upErr) {
    console.error(`\nUpsert failed: ${upErr.message}`);
    process.exit(1);
  }

  console.log(
    `\nDone. ${payload.length} entr${payload.length === 1 ? 'y' : 'ies'} upserted.\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
