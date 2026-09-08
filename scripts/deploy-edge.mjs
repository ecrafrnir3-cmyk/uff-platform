// Deploy a Supabase edge function from the CLI, reading the access token from
// .env.local so nothing secret has to be pasted anywhere.
//
//   node scripts/deploy-edge.mjs score-matchups --no-verify-jwt
//   node scripts/deploy-edge.mjs finalize-week
//
// ONE-TIME SETUP (Nate — this is the bit only you can do):
//   1. Create a Personal Access Token: https://supabase.com/dashboard/account/tokens
//   2. Add this line to C:\Users\ecraf\Claude\Projects\UFF\.env.local
//        SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
//   Do NOT paste the token into chat — .env.local is gitignored and stays local.
//
// WHY THIS EXISTS: `supabase login` cannot run in a non-TTY shell ("Cannot use
// automatic login flow inside non-TTY environments"), so an assistant session
// can't authenticate the CLI. Without a token, the only way to ship an edge
// function is to inline the entire file through the MCP deploy tool — which is
// how score-matchups v19 shipped on 2026-09-08. With the token present, this
// script makes it a one-liner.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROJECT_REF = "synfuvgdamhjboobjmls";

const [fn, ...rest] = process.argv.slice(2);
if (!fn) {
  console.error("usage: node scripts/deploy-edge.mjs <function-name> [--no-verify-jwt]");
  process.exit(1);
}

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* env may come from the shell instead */ }

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is not set.\n" +
    "Create one at https://supabase.com/dashboard/account/tokens and add it to .env.local as:\n" +
    "  SUPABASE_ACCESS_TOKEN=sbp_...\n" +
    "(Until then, edge functions must be deployed through the Supabase MCP tool.)"
  );
  process.exit(1);
}

const args = ["-y", "supabase", "functions", "deploy", fn, "--project-ref", PROJECT_REF, ...rest];
console.log(`> npx ${args.join(" ")}`);
const r = spawnSync("npx", args, { stdio: "inherit", shell: true, env: process.env });
process.exit(r.status ?? 1);
