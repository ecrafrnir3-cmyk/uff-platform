#!/usr/bin/env node
/**
 * generate-portraits.mjs — turn art/higgsfield-brief.md into character portraits,
 * using the Gemini image API directly instead of a subscription reseller.
 *
 * WHY THIS EXISTS (2026-10-05)
 * The brief has been finished and unused since 2026-08-26. A Higgsfield PLUS
 * purchase was decided on 2026-09-13 and never made — the account is still free
 * with 0 credits — so all 20 characters still render as placeholder silhouettes
 * and the Comics section ships without art. Higgsfield is largely a storefront:
 * its "Nano Banana" IS Google's Gemini image model, resold with a subscription
 * wrapper and no one-time top-ups. Direct, the whole 80-image set costs ~$5
 * against $468/yr. Same model family the brief was written against.
 *
 * SAFETY, because this spends real money:
 *   * It will NOT call the API without --yes. Default is a dry run.
 *   * It refuses to start if the estimated cost exceeds --max-cost (default $2).
 *   * It never prints or logs the API key.
 *   * It skips files that already exist unless --force.
 *   * On an unexpected response it writes the raw payload to the output dir and
 *     stops, rather than looping and billing for failures.
 *
 * USAGE
 *   node scripts/generate-portraits.mjs --list
 *   node scripts/generate-portraits.mjs --only 7,13 --variants 3 --dry-run
 *   node scripts/generate-portraits.mjs --only 7,13 --variants 3 --yes
 *   node scripts/generate-portraits.mjs --yes --max-cost 6          # all 20
 *   node scripts/generate-portraits.mjs --only 8 --ref public/art/characters/rook-callahan-v1.png --yes
 *
 * KEY: GEMINI_API_KEY, from the environment or .env.local (gitignored). Get one
 * free at https://aistudio.google.com/apikey — billing needs a $5 minimum credit,
 * which is prepaid usage, not a subscription.
 *
 * AFTER GENERATING: pick the keeper variant per character, rename it to
 * <slug>.png, and set uff_characters.art_url to /art/characters/<slug>.png.
 * Files in public/ are served free by Vercel — no storage bucket needed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BRIEF = path.join(ROOT, "art", "higgsfield-brief.md");

// Per-image USD, from ai.google.dev/gemini-api/docs/pricing (checked 2026-10-05).
// Used only for the estimate and the --max-cost guard; it bills what it bills.
const PRICING = {
  "gemini-3.1-flash-image":      { "0.5K": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 },
  "gemini-3.1-flash-lite-image": { "1K": 0.0336 },
  "gemini-3-pro-image":          { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
};

function parseArgs(argv) {
  const a = {
    only: null, variants: 3, model: "gemini-3.1-flash-image", size: "1K",
    out: path.join("public", "art", "characters"), maxCost: 2, yes: false,
    dryRun: false, list: false, force: false, refs: [], delayMs: 1200,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--only") a.only = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--variants") a.variants = parseInt(next(), 10);
    else if (k === "--model") a.model = next();
    else if (k === "--size") a.size = next();
    else if (k === "--out") a.out = next();
    else if (k === "--max-cost") a.maxCost = parseFloat(next());
    else if (k === "--ref") a.refs.push(next());
    else if (k === "--delay") a.delayMs = parseInt(next(), 10);
    else if (k === "--yes") a.yes = true;
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--list") a.list = true;
    else if (k === "--force") a.force = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

/** Key from env, else .env.local. Returned, never logged. */
async function readApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    const env = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const line = env.split("\n").find((l) => /^\s*GEMINI_API_KEY\s*=/.test(l));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch { /* no .env.local — fall through */ }
  return null;
}

const slugify = (name) =>
  name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

/**
 * The brief's shape: a faction H1 ("# ⚔ Vanguard (Heroes)"), then per character
 * "## 7. Rook Callahan — "The Undrafted"" followed by ONE self-contained prompt
 * paragraph that already carries the style bible, framing spec and faction
 * grading. So the prompt is taken verbatim — never re-assembled here, because the
 * brief is the source of truth and a paraphrase would drift the style.
 */
async function parseBrief() {
  const text = await fs.readFile(BRIEF, "utf8");
  const lines = text.split("\n");

  let negative = "";
  const negIdx = lines.findIndex((l) => /^##\s+Shared Negative Prompt/i.test(l));
  if (negIdx !== -1) {
    for (let i = negIdx + 1; i < lines.length && !/^#/.test(lines[i]); i++) {
      if (/^>/.test(lines[i])) negative += lines[i].replace(/^>\s?/, "").trim() + " ";
    }
  }

  const chars = [];
  let faction = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#\s/.test(l) && /vanguard/i.test(l)) { faction = "hero"; continue; }
    if (/^#\s/.test(l) && /dominion/i.test(l)) { faction = "villain"; continue; }

    const m = l.match(/^##\s+(\d+)\.\s+([^—–]+)[—–]\s*"?([^"*]*)"?/);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    const name = m[2].trim();
    const epithet = (m[3] || "").trim().replace(/\s*\*\(.*$/, "");

    // the first non-empty, non-heading line after the heading is the prompt
    let prompt = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#/.test(lines[j])) break;
      if (lines[j].trim()) { prompt = lines[j].trim(); break; }
    }
    if (!prompt) continue;
    chars.push({ number, name, epithet, faction, slug: slugify(name), prompt });
  }
  return { chars, negative: negative.trim() };
}

function select(chars, only) {
  if (!only) return chars;
  const want = new Set(only.map((s) => s.toLowerCase()));
  return chars.filter(
    (c) => want.has(String(c.number)) || want.has(c.slug) || want.has(c.name.toLowerCase()),
  );
}

async function loadRefs(paths) {
  const out = [];
  for (const p of paths) {
    const buf = await fs.readFile(path.isAbsolute(p) ? p : path.join(ROOT, p));
    const ext = path.extname(p).toLowerCase();
    out.push({
      type: "image",
      mime_type: ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png",
      data: buf.toString("base64"),
    });
  }
  return out;
}

function buildRequest({ model, prompt, negative, size, refs }) {
  const text = negative ? `${prompt}\n\nAvoid: ${negative}` : prompt;
  return {
    model,
    input: [...refs, { type: "text", text }],
    response_format: { type: "image", mime_type: "image/png", aspect_ratio: "1:1", image_size: size },
  };
}

/** Dig the base64 image out of the response, tolerating more than one shape. */
function extractImage(json) {
  if (json?.output_image?.data) return json.output_image.data;
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p?.inlineData?.data) return p.inlineData.data;
    if (p?.inline_data?.data) return p.inline_data.data;
  }
  for (const o of json?.output ?? []) {
    if (o?.data && typeof o.data === "string") return o.data;
    if (o?.image?.data) return o.image.data;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(await fs.readFile(new URL(import.meta.url)).then((b) =>
      b.toString().split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, "")));
    return;
  }

  const { chars, negative } = await parseBrief();
  const picked = select(chars, args.only);

  if (!picked.length) {
    console.error(`No characters matched. Parsed ${chars.length} from the brief; try --list.`);
    process.exitCode = 1;
    return;
  }

  if (args.list) {
    console.log(`Parsed ${chars.length} characters from art/higgsfield-brief.md\n`);
    for (const c of chars) {
      console.log(`  ${String(c.number).padStart(2)}. ${c.slug.padEnd(16)} ${c.faction.padEnd(8)} ${c.name} — "${c.epithet}" (${c.prompt.length} chars)`);
    }
    console.log(`\nShared negative prompt: ${negative.length} chars`);
    return;
  }

  const perImage = PRICING[args.model]?.[args.size];
  if (perImage == null) {
    console.error(`No price on file for ${args.model} @ ${args.size}. Known: ${Object.keys(PRICING).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const total = picked.length * args.variants;
  const estimate = total * perImage;

  console.log(`model     ${args.model} @ ${args.size}`);
  console.log(`subjects  ${picked.length} (${picked.map((c) => c.slug).join(", ")})`);
  console.log(`variants  ${args.variants}  ->  ${total} images`);
  console.log(`estimate  $${estimate.toFixed(2)}  ($${perImage}/image)`);
  if (args.refs.length) console.log(`refs      ${args.refs.join(", ")}`);
  console.log(`out       ${args.out}`);

  if (estimate > args.maxCost) {
    console.error(`\nREFUSING: estimate $${estimate.toFixed(2)} exceeds --max-cost $${args.maxCost.toFixed(2)}.`);
    console.error(`Raise it deliberately if that is what you want: --max-cost ${Math.ceil(estimate)}`);
    process.exitCode = 1;
    return;
  }

  if (!args.yes || args.dryRun) {
    console.log(`\nDRY RUN — nothing called, nothing spent. Add --yes to generate.`);
    const sample = buildRequest({ model: args.model, prompt: picked[0].prompt, negative, size: args.size, refs: [] });
    console.log(`\nFirst request body (${picked[0].slug}), truncated:`);
    console.log(JSON.stringify(sample, null, 2).slice(0, 900) + "\n  ...");
    return;
  }

  const key = await readApiKey();
  if (!key) {
    console.error("\nNo GEMINI_API_KEY in the environment or .env.local.");
    console.error("Get one at https://aistudio.google.com/apikey, then add to .env.local:");
    console.error("  GEMINI_API_KEY=your-key-here");
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(path.join(ROOT, args.out), { recursive: true });
  const refs = args.refs.length ? await loadRefs(args.refs) : [];
  const manifest = [];
  let made = 0, skipped = 0, spent = 0;

  for (const c of picked) {
    for (let v = 1; v <= args.variants; v++) {
      const file = path.join(ROOT, args.out, `${c.slug}-v${v}.png`);
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (!args.force) {
        try { await fs.access(file); console.log(`  skip  ${rel} (exists)`); skipped++; continue; } catch { /* generate it */ }
      }

      const body = buildRequest({ model: args.model, prompt: c.prompt, negative, size: args.size, refs });
      let res, json;
      try {
        res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
        });
        json = await res.json();
      } catch (err) {
        console.error(`  FAIL  ${rel}: ${err.message}`);
        process.exitCode = 1;
        return;
      }

      if (!res.ok) {
        console.error(`  FAIL  ${rel}: HTTP ${res.status} ${json?.error?.message ?? ""}`);
        const dump = path.join(ROOT, args.out, "_last-error.json");
        await fs.writeFile(dump, JSON.stringify(json, null, 2));
        console.error(`  Raw response written to ${path.relative(ROOT, dump)}. Stopping so this does not bill in a loop.`);
        process.exitCode = 1;
        return;
      }

      const b64 = extractImage(json);
      if (!b64) {
        const dump = path.join(ROOT, args.out, "_unexpected-response.json");
        await fs.writeFile(dump, JSON.stringify(json, null, 2));
        console.error(`  FAIL  ${rel}: 200 OK but no image found in the response.`);
        console.error(`  Raw response written to ${path.relative(ROOT, dump)} — the API shape likely moved; fix extractImage().`);
        process.exitCode = 1;
        return;
      }

      await fs.writeFile(file, Buffer.from(b64, "base64"));
      made++; spent += perImage;
      console.log(`  ok    ${rel}  ($${spent.toFixed(2)} so far)`);
      manifest.push({ slug: c.slug, name: c.name, faction: c.faction, variant: v, file: rel, model: args.model, size: args.size });
      if (args.delayMs) await new Promise((r) => setTimeout(r, args.delayMs));
    }
  }

  if (manifest.length) {
    const mf = path.join(ROOT, args.out, "manifest.json");
    let prev = [];
    try { prev = JSON.parse(await fs.readFile(mf, "utf8")); } catch { /* first run */ }
    await fs.writeFile(mf, JSON.stringify([...prev, ...manifest], null, 2));
  }

  console.log(`\n${made} generated, ${skipped} skipped. Estimated spend $${spent.toFixed(2)}.`);
  console.log(`Pick a keeper per character, rename to <slug>.png, then set uff_characters.art_url = /art/characters/<slug>.png`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
