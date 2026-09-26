// Regenerate the disaster-recovery snapshots under supabase/schema-snapshot/ from the LIVE
// database (audit A1-17 / A1-18: the hand-maintained copies lagged the migrations).
//
//   node scripts/snapshot-schema.mjs
//
// Reads SUPABASE_ACCESS_TOKEN from .env.local (the Management API token; never printed) and
// writes four files:
//   functions.sql  every function in schema public, pg_get_functiondef, alphabetical
//   policies.sql   every RLS policy in schema public, reconstructed as CREATE POLICY
//   triggers.sql   every user-defined trigger on a public table, pg_get_triggerdef
//   tables.sql     every public table: columns, constraints, indexes, RLS flag
// Read-only: it only SELECTs. Run it after every migration and commit the result.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT = "synfuvgdamhjboobjmls";
const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = resolve(ROOT, "supabase/schema-snapshot");

function token() {
  const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("SUPABASE_ACCESS_TOKEN="));
  if (!line) throw new Error("SUPABASE_ACCESS_TOKEN not found in .env.local");
  return line.slice("SUPABASE_ACCESS_TOKEN=".length).trim().replace(/^['"]|['"]$/g, "");
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const stamp = new Date().toISOString().slice(0, 10);
const banner = (what) =>
  `-- UFF ${what} snapshot: generated ${stamp} by scripts/snapshot-schema.mjs from the live DB\n` +
  `-- (project ${PROJECT}). NOT a migration — disaster-recovery source of truth. Regenerate after\n` +
  `-- every migration; never hand-edit.\n\n`;

// functions
const fns = await query(
  `SELECT p.proname, pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
    ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)`
);
writeFileSync(resolve(OUT, "functions.sql"), banner("function") + fns.map((r) => r.def.replace(/\n$/, "") + "\n;\n").join("\n"));

// policies
const pols = await query(
  `SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
     FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`
);
const polSql = pols.map((p) => {
  const roles = (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, "").split(",")).join(", ");
  let s = `CREATE POLICY "${p.policyname}" ON public.${p.tablename}`;
  if (p.permissive === "RESTRICTIVE") s += " AS RESTRICTIVE";
  s += ` FOR ${p.cmd} TO ${roles}`;
  if (p.qual) s += `\n  USING (${p.qual})`;
  if (p.with_check) s += `\n  WITH CHECK (${p.with_check})`;
  return s + ";\n";
});
writeFileSync(resolve(OUT, "policies.sql"), banner("RLS policy") + polSql.join("\n"));

// triggers
const trgs = await query(
  `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`
);
writeFileSync(resolve(OUT, "triggers.sql"), banner("trigger") + trgs.map((r) => r.def + ";\n").join("\n"));

// tables
const cols = await query(
  `SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
          pg_get_expr(d.adbin, d.adrelid) AS def, c.relrowsecurity
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`
);
const cons = await query(
  `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def, conindid
     FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conrelid::regclass::text, conname`
);
const idxs = await query(
  `SELECT i.tablename, i.indexname, i.indexdef
     FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class ic ON ic.oid = k.conindid WHERE ic.relname = i.indexname)
    ORDER BY i.tablename, i.indexname`
);
const byTable = new Map();
for (const r of cols) {
  if (!byTable.has(r.relname)) byTable.set(r.relname, { cols: [], rls: r.relrowsecurity });
  byTable.get(r.relname).cols.push(`  ${r.attname} ${r.type}${r.def ? ` DEFAULT ${r.def}` : ""}${r.attnotnull ? " NOT NULL" : ""}`);
}
let tsql = "";
for (const [name, t] of [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  tsql += `CREATE TABLE public.${name} (\n${t.cols.join(",\n")}\n);\n`;
  for (const k of cons.filter((k) => k.tbl === `public.${name}` || k.tbl === name)) {
    tsql += `ALTER TABLE public.${name} ADD CONSTRAINT ${k.conname} ${k.def};\n`;
  }
  for (const x of idxs.filter((x) => x.tablename === name)) tsql += `${x.indexdef};\n`;
  if (t.rls) tsql += `ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;\n`;
  tsql += "\n";
}
writeFileSync(resolve(OUT, "tables.sql"), banner("table") + tsql);

console.log(`snapshot written: ${fns.length} functions, ${pols.length} policies, ${trgs.length} triggers, ${byTable.size} tables`);
