#!/usr/bin/env node
// Cron census: do the five GitHub Actions schedules fire, and when?
//
//   node scripts/cron-census.mjs                 # live, no token needed (60 req/h unauthenticated)
//   node scripts/cron-census.mjs --cache DIR     # save raw API pages to DIR and reuse them next time
//   node scripts/cron-census.mjs --from DIR      # offline: read saved `gh api` output instead of the API
//   node scripts/cron-census.mjs --now ISO       # pretend the measurement happened at ISO (reproducibility)
//
// Read-only. It only GETs /repos/{owner}/{repo}/actions/workflows and .../workflows/{file}/runs
// (per_page=100, windowed with the `created` filter, paged). It never triggers, re-runs,
// cancels or edits anything. The whole census is a few dozen requests.
//
// Token: optional. GITHUB_TOKEN or GH_TOKEN is sent as a bearer if present and is never
// printed. The literal value "proxy-injected" (what the Claude sandbox puts there) is ignored.
// Inside that sandbox node must be started with NODE_USE_ENV_PROXY=1 or it cannot reach
// api.github.com at all; outside it plain `node` is enough.
//
// Offline mode (--from DIR): DIR holds one JSON file per workflow, named after the workflow
// file (score-matchups.json, ...). Each file may be a page object ({workflow_runs:[...]}),
// an array of runs, or an array of page objects (what `gh api --paginate --slurp` writes).
//
// Everything below "ANALYSIS" is pure arithmetic on the run list; nothing is inferred from
// a run's colour. A green run only proves the curl got a 2xx.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const OWNER = "ecrafrnir3-cmyk";
const REPO = "uff-platform";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/actions`;

// The cron line in force on each date, per workflow. score-matchups changed twice; the
// boundaries are the commit times of 7b36bbb and dfacef2 (git log -p -- the workflow file).
// Git history before 2026-09-08 is gone (the repo was re-rooted), so the first line is the
// one the earliest surviving commit carries; the report says so.
const WORKFLOWS = {
  "score-matchups.yml": {
    label: "score-matchups",
    periods: [
      { name: "P1 one curl, no Wednesday", until: "2026-09-23T13:02:57Z", cron: "0,15,30,45 * * * 0,1,2,4,5,6" },
      { name: "P2 one curl, every day", until: "2026-09-27T00:54:39Z", cron: "0,15,30,45 * * * *" },
      { name: "P3 5h30m loop + concurrency", until: null, cron: "0,15,30,45 * * * *" },
    ],
  },
  "process-waivers.yml": { label: "process-waivers", periods: [{ name: "hourly", until: null, cron: "0 * * * *" }] },
  "finalize-week.yml": {
    label: "finalize-week",
    // Invalid YAML until 2026-07-22T08:51Z (the workflow's own header). Slots are counted from
    // the first Wednesday after that; earlier "runs" are push-time parse failures.
    validFrom: "2026-07-22T08:51:40Z",
    periods: [{ name: "weekly", until: null, cron: "0 7 * * 3" }],
  },
  "generate-newsletter.yml": { label: "generate-newsletter", periods: [{ name: "weekly", until: null, cron: "30 7 * * 3" }] },
  "sync-projections.yml": { label: "sync-projections", periods: [{ name: "weekly", until: null, cron: "0 8 * * 3" }] },
};
const WEDNESDAY_JOBS = ["finalize-week.yml", "generate-newsletter.yml", "sync-projections.yml"];
const LOOP_SINCE = "2026-09-27T00:54:39Z"; // dfacef2

// ───────────────────────────── CLI ─────────────────────────────
const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const CACHE = opt("--cache");
const FROM = opt("--from");
const NOW = opt("--now") ? new Date(opt("--now")) : new Date();
if (Number.isNaN(NOW.getTime())) { console.error("bad --now"); process.exit(2); }

function token() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (!t || t === "proxy-injected") return null;
  return t;
}

// ───────────────────────────── FETCH ─────────────────────────────
let requests = 0;
async function getJson(url) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "uff-cron-census" };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  requests++;
  const res = await fetch(url, { headers });
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(Number(reset) * 1000).toISOString() : "unknown";
    throw new Error(`GitHub answered ${res.status} (rate limit remaining=${remaining}, resets ${when}). Wait, or set GITHUB_TOKEN.`);
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`);
  return res.json();
}

function ymd(d) { return d.toISOString().slice(0, 10); }

// All runs of one workflow inside [from, to] (dates), split further when a window would
// exceed the API's 1000-result ceiling.
async function fetchWindow(file, from, to, pages) {
  const created = `${ymd(from)}..${ymd(to)}`;
  const first = await getJson(`${API}/workflows/${file}/runs?per_page=100&page=1&created=${created}`);
  if (first.total_count > 1000 && to - from > 86400000) {
    const mid = new Date(from.getTime() + Math.floor((to - from) / 2 / 86400000) * 86400000);
    const next = new Date(mid.getTime() + 86400000);
    return [...(await fetchWindow(file, from, mid, pages)), ...(await fetchWindow(file, next, to, pages))];
  }
  pages.push(first);
  let runs = first.workflow_runs;
  for (let page = 2; runs.length < first.total_count; page++) {
    const p = await getJson(`${API}/workflows/${file}/runs?per_page=100&page=${page}&created=${created}`);
    pages.push(p);
    if (p.workflow_runs.length === 0) break;
    runs = runs.concat(p.workflow_runs);
  }
  return runs;
}

async function fetchAll() {
  const out = {};
  const list = await getJson(`${API}/workflows?per_page=100`);
  for (const file of Object.keys(WORKFLOWS)) {
    const cachePath = CACHE && resolve(CACHE, file.replace(/\.yml$/, ".json"));
    if (cachePath && existsSync(cachePath)) { out[file] = loadRuns(cachePath); continue; }
    const wf = list.workflows.find((w) => w.path.endsWith("/" + file));
    if (!wf) throw new Error(`workflow ${file} not found in the API listing`);
    const pages = [];
    let runs = [];
    // Month windows from the month the workflow was registered to now.
    let from = new Date(wf.created_at.slice(0, 7) + "-01T00:00:00Z");
    while (from <= NOW) {
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
      runs = runs.concat(await fetchWindow(file, from, to, pages));
      from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    }
    if (cachePath) { mkdirSync(CACHE, { recursive: true }); writeFileSync(cachePath, JSON.stringify(pages)); }
    out[file] = runs;
  }
  return out;
}

function loadRuns(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const pages = Array.isArray(raw) ? raw : [raw];
  const runs = [];
  for (const p of pages) {
    if (Array.isArray(p)) runs.push(...p);
    else if (p && Array.isArray(p.workflow_runs)) runs.push(...p.workflow_runs);
    else if (p && p.id) runs.push(p);
  }
  return runs;
}

function loadFrom(dir) {
  const out = {};
  for (const file of Object.keys(WORKFLOWS)) {
    const p = resolve(dir, file.replace(/\.yml$/, ".json"));
    if (!existsSync(p)) throw new Error(`--from: missing ${p}`);
    out[file] = loadRuns(p);
  }
  return out;
}

// ───────────────────────────── CRON ─────────────────────────────
function field(spec, min, max) {
  const set = new Set();
  for (const part of spec.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    let lo = min, hi = max;
    if (range !== "*") { const [a, b] = range.split("-").map(Number); lo = a; hi = b ?? a; }
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}
function parseCron(line) {
  const [m, h, dom, mon, dow] = line.trim().split(/\s+/);
  return { m: field(m, 0, 59), h: field(h, 0, 23), dom: field(dom, 1, 31), mon: field(mon, 1, 12), dow: field(dow, 0, 7) };
}
function cronMatches(c, d) {
  return c.m.has(d.getUTCMinutes()) && c.h.has(d.getUTCHours()) && c.dom.has(d.getUTCDate()) &&
    c.mon.has(d.getUTCMonth() + 1) && (c.dow.has(d.getUTCDay()) || (d.getUTCDay() === 0 && c.dow.has(7)));
}
// Every slot the cron in force declares between from and to (inclusive), minute resolution.
function slots(file, from, to) {
  const wf = WORKFLOWS[file];
  const parsed = wf.periods.map((p) => ({ until: p.until ? new Date(p.until) : null, cron: parseCron(p.cron) }));
  const out = [];
  const start = new Date(Math.ceil(from.getTime() / 60000) * 60000);
  for (let t = start.getTime(); t <= to.getTime(); t += 60000) {
    const d = new Date(t);
    const period = parsed.find((p) => !p.until || d < p.until);
    if (cronMatches(period.cron, d)) out.push(d);
  }
  return out;
}

// ───────────────────────────── HELPERS ─────────────────────────────
const D = (s) => new Date(s);
const min = (ms) => Math.round(ms / 60000);
function hm(ms) {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  if (abs < 120000) return `${sign}${Math.round(abs / 1000)}s`;
  const m = Math.round(abs / 60000);
  return m >= 60 ? `${sign}${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${sign}${m}m`;
}
const iso = (d) => d.toISOString().replace(".000Z", "Z").slice(0, 16) + "Z";
function pct(sorted, p) { if (!sorted.length) return null; return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))]; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); return pct(s, 0.5); }
function started(r) { return D(r.run_started_at || r.created_at); }
function ended(r) { return r.status === "completed" ? D(r.updated_at) : NOW; }
function periodOf(file, r) {
  const ps = WORKFLOWS[file].periods;
  const c = D(r.created_at);
  return ps.find((p) => !p.until || c < D(p.until)).name;
}
function count(items, key) {
  const m = {};
  for (const it of items) { const k = key(it); m[k] = (m[k] || 0) + 1; }
  return m;
}
function fmtCounts(m) { return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "); }
const log = (...a) => console.log(...a);

// ───────────────────────────── ANALYSIS ─────────────────────────────
function perWorkflowCounts(file, runs) {
  log(`\n### ${WORKFLOWS[file].label}: ${runs.length} runs`);
  log(`- by event: ${fmtCounts(count(runs, (r) => r.event))}`);
  log(`- by conclusion: ${fmtCounts(count(runs, (r) => r.conclusion || r.status))}`);
  for (const p of WORKFLOWS[file].periods) {
    if (WORKFLOWS[file].periods.length === 1) break;
    const rs = runs.filter((r) => periodOf(file, r) === p.name);
    log(`- ${p.name} (${rs.length}): event ${fmtCounts(count(rs, (r) => r.event))}; conclusion ${fmtCounts(count(rs, (r) => r.conclusion || r.status))}`);
  }
  const bad = runs.filter((r) => ["failure", "timed_out"].includes(r.conclusion) && ["schedule", "workflow_dispatch"].includes(r.event));
  if (bad.length) {
    log(`- failed or timed out on schedule/dispatch (${bad.length}):`);
    for (const r of bad.sort((a, b) => started(a) - started(b)))
      log(`  - ${iso(started(r))} ${r.event} ${r.conclusion} after ${hm(ended(r) - started(r))} → ${r.html_url}`);
  } else log(`- failed or timed out on schedule/dispatch: none`);
  const pushFail = runs.filter((r) => r.event === "push" && r.conclusion === "failure");
  if (pushFail.length) {
    const s = pushFail.map(started).sort((a, b) => a - b);
    log(`- push-event failures (parse errors, counted not linked): ${pushFail.length}, from ${ymd(s[0])} to ${ymd(s[s.length - 1])}`);
  }
  const cancelled = runs.filter((r) => r.conclusion === "cancelled");
  if (cancelled.length) {
    // A replacement is the design: the new run is created, starts, and cancels the old
    // one (so it usually starts a minute or two BEFORE the cancellation is recorded).
    // "Replaced" = the next run created after this one started no later than one
    // minute after the cancellation. Anything else is an orphaned cancel.
    const sorted = [...runs].sort((a, b) => D(a.created_at) - D(b.created_at));
    let replaced = 0; const orphans = [];
    for (const c of cancelled) {
      const cancelAt = D(c.updated_at);
      const next = sorted.find((r) => r.id !== c.id && D(r.created_at) > D(c.created_at));
      if (next && started(next).getTime() <= cancelAt.getTime() + 60000) replaced++; else orphans.push({ c, next });
    }
    log(`- cancelled: ${cancelled.length}; ${replaced} were followed by a new run starting within a minute of the cancellation; ${orphans.length} were not${orphans.length ? ":" : "."}`);
    for (const { c, next } of orphans.sort((a, b) => started(a.c) - started(b.c)))
      log(`  - cancelled ${iso(D(c.updated_at))} (started ${iso(started(c))}); next run started ${next ? iso(started(next)) + " (" + hm(started(next) - D(c.updated_at)) + " later)" : "never"} → ${c.html_url}`);
  }
}

function durations(file, runs) {
  const groups = {};
  for (const r of runs) {
    if (r.status !== "completed" || r.event === "push") continue;
    (groups[periodOf(file, r)] ||= []).push(r);
  }
  for (const [name, rs] of Object.entries(groups)) {
    const ds = rs.map((r) => ({ d: ended(r) - started(r), r }));
    const med = median(ds.map((x) => x.d));
    const worst = ds.reduce((a, b) => (b.d > a.d ? b : a));
    const byC = {};
    for (const x of ds) (byC[x.r.conclusion] ||= []).push(x.d);
    const parts = Object.entries(byC).map(([c, arr]) => `${c} median ${hm(median(arr))} (n=${arr.length})`).join("; ");
    log(`| ${WORKFLOWS[file].label} | ${name} | ${rs.length} | ${hm(med)} | ${hm(worst.d)} on ${iso(started(worst.r))} (${worst.r.conclusion}) | ${parts} |`);
  }
}

function wednesdayTable(file, runs) {
  const wf = WORKFLOWS[file];
  const sched = runs.filter((r) => r.event === "schedule").sort((a, b) => D(a.created_at) - D(b.created_at));
  const from = wf.validFrom ? D(wf.validFrom) : (sched.length ? new Date(D(sched[0].created_at) - 7 * 86400000) : NOW);
  const all = slots(file, from, NOW);
  const rows = [];
  const used = new Set();
  for (const s of all) {
    const run = sched.find((r) => !used.has(r.id) && D(r.created_at) >= s && D(r.created_at) - s < 7 * 86400000);
    if (run) used.add(run.id);
    rows.push({ slot: s, run });
  }
  log(`\n### ${wf.label} (cron \`${wf.periods[0].cron}\`), ${sched.length} scheduled runs, ${all.length} slots since ${ymd(from)}`);
  log(`| slot (UTC) | run started | delay | ran for | conclusion |`);
  log(`|---|---|---|---|---|`);
  for (const { slot, run } of rows) {
    if (!run) { log(`| ${iso(slot)} | — | **no run** | | |`); continue; }
    log(`| ${iso(slot)} | ${iso(started(run))} | ${hm(started(run) - slot)} | ${hm(ended(run) - started(run))} | ${run.conclusion || run.status} |`);
  }
  const unmatched = sched.filter((r) => !used.has(r.id));
  if (unmatched.length) log(`- scheduled runs not matched to a slot: ${unmatched.length}`);
  return rows;
}

function dailyGaps(file, runs) {
  const wf = WORKFLOWS[file];
  const sorted = runs.filter((r) => r.event !== "push").sort((a, b) => started(a) - started(b));
  const periods = wf.periods;
  for (const p of periods) {
    const rs = sorted.filter((r) => periodOf(file, r) === p.name);
    if (!rs.length) continue;
    const pFrom = periods.indexOf(p) === 0 ? started(rs[0]) : D(periods[periods.indexOf(p) - 1].until);
    const pTo = p.until ? new Date(D(p.until) - 1) : NOW;
    const gaps = [];
    for (let i = 1; i < rs.length; i++) gaps.push({ g: started(rs[i]) - started(rs[i - 1]), at: started(rs[i - 1]), to: started(rs[i]) });
    const gs = gaps.map((x) => x.g).sort((a, b) => a - b);
    const worst = gaps.reduce((a, b) => (b.g > a.g ? b : a), gaps[0]);
    log(`\n#### ${wf.label} — ${p.name} (cron \`${p.cron}\`), ${rs.length} runs from ${iso(pFrom)} to ${iso(pTo)}`);
    if (gaps.length) log(`- gap between consecutive run starts: median ${hm(pct(gs, 0.5))}, p90 ${hm(pct(gs, 0.9))}, worst ${hm(worst.g)} (from ${iso(worst.at)} to ${iso(worst.to)})`);
    // per UTC day
    const days = {};
    for (const s of slots(file, pFrom, pTo)) (days[ymd(s)] ||= { slots: 0, sched: 0, other: 0, gaps: [] }).slots++;
    for (const r of rs) { const d = (days[ymd(started(r))] ||= { slots: 0, sched: 0, other: 0, gaps: [] }); if (r.event === "schedule") d.sched++; else d.other++; }
    for (const g of gaps) (days[ymd(g.at)] ||= { slots: 0, sched: 0, other: 0, gaps: [] }).gaps.push(g.g);
    const keys = Object.keys(days).sort();
    const totalSlots = keys.reduce((a, k) => a + days[k].slots, 0);
    const totalRuns = keys.reduce((a, k) => a + days[k].sched + days[k].other, 0);
    log(`- slots declared ${totalSlots}, runs started ${totalRuns} (${(100 * totalRuns / Math.max(1, totalSlots)).toFixed(1)}%)`);
    log(`\n| UTC day | slots | scheduled runs | other runs | longest gap starting that day |`);
    log(`|---|---|---|---|---|`);
    for (const k of keys) {
      const d = days[k];
      const lg = d.gaps.length ? hm(Math.max(...d.gaps)) : "";
      log(`| ${k} | ${d.slots} | ${d.sched} | ${d.other} | ${lg} |`);
    }
  }
}

// Game windows (UTC) for every NFL week from `from` to NOW. Eastern is UTC-4 until Nov 1.
function gameWindows(from) {
  const out = [];
  // walk day by day; Thursday night = Fri 00:15–04:15, Sunday = 17:00–Mon 05:00, Monday night = Tue 00:15–04:15
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= NOW.getTime(); t += 86400000) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 5) out.push({ name: "Thu night", a: new Date(t + 15 * 60000), b: new Date(t + 4 * 3600000 + 15 * 60000) });
    if (dow === 0) out.push({ name: "Sunday", a: new Date(t + 17 * 3600000), b: new Date(t + 29 * 3600000) });
    if (dow === 2) out.push({ name: "Mon night", a: new Date(t + 15 * 60000), b: new Date(t + 4 * 3600000 + 15 * 60000) });
  }
  return out.filter((w) => w.a >= from);
}

function coverage(runs) {
  const rs = runs.filter((r) => D(r.created_at) >= D(LOOP_SINCE) && r.event !== "push").sort((a, b) => started(a) - started(b));
  const ivs = rs.map((r) => ({ a: started(r), b: ended(r), r }));
  log(`\n### score-matchups coverage since dfacef2 (${rs.length} runs; a run covers run_started_at → updated_at)`);
  const windows = gameWindows(D(LOOP_SINCE));
  let holes = 0, holeMinutes = 0, windowMinutes = 0;
  const rows = [];
  for (const w of windows) {
    if (w.b > NOW) w.b = NOW;
    windowMinutes += min(w.b - w.a);
    // uncovered stretches inside [w.a, w.b]
    let cursor = w.a;
    const inside = ivs.filter((iv) => iv.b > w.a && iv.a < w.b).sort((x, y) => x.a - y.a);
    const gapsHere = [];
    for (const iv of inside) {
      if (iv.a > cursor) gapsHere.push({ a: cursor, b: iv.a });
      if (iv.b > cursor) cursor = iv.b;
    }
    if (cursor < w.b) gapsHere.push({ a: cursor, b: w.b });
    for (const g of gapsHere) {
      if (g.b - g.a <= 15 * 60000) continue;
      holes++; holeMinutes += min(g.b - g.a);
      const prev = ivs.filter((iv) => iv.b.getTime() <= g.a.getTime() + 1000).sort((x, y) => y.b - x.b)[0];
      const cause = !prev ? "no run before it" : prev.r.conclusion === "success" ? "finished on its own" : prev.r.conclusion || prev.r.status;
      const next = ivs.find((iv) => iv.a.getTime() >= g.b.getTime() - 1000);
      rows.push({ w, g, prev, cause, next });
    }
  }
  log(`- game windows examined: ${windows.length} (${hm(windowMinutes * 60000)} of game time); stretches > 15 min with no run in progress: ${holes}, totalling ${hm(holeMinutes * 60000)}`);
  log(`\n| window | hole start | hole end | length | what ended the run before it | that run | next run started |`);
  log(`|---|---|---|---|---|---|---|`);
  for (const { w, g, prev, cause, next } of rows) {
    const atKick = g.a.getTime() === w.a.getTime() ? " (open at kickoff)" : "";
    log(`| ${w.name} ${ymd(w.a)} | ${iso(g.a)}${atKick} | ${iso(g.b)} | ${hm(g.b - g.a)} | ${cause}${prev ? " at " + iso(prev.b) : ""} | ${prev ? `[run](${prev.r.html_url})` : ""} | ${next ? iso(next.a) : "—"} |`);
  }
  // run-to-run: did every run start before the previous one ended?
  let overlaps = 0, breaks = 0, holeAny = 0, holeAnyMin = 0, longest = null;
  for (let i = 1; i < ivs.length; i++) {
    if (ivs[i].a <= ivs[i - 1].b) { overlaps++; continue; }
    breaks++;
    const len = ivs[i].a - ivs[i - 1].b;
    if (len > 15 * 60000) { holeAny++; holeAnyMin += min(len); if (!longest || len > longest.len) longest = { len, from: ivs[i - 1].b, to: ivs[i].a }; }
  }
  const span = NOW - ivs[0].a;
  log(`\n- consecutive runs since dfacef2: ${overlaps} started while the previous run was still running (replacement), ${breaks} started after the previous run had already ended`);
  log(`- holes > 15 min at any hour since dfacef2: ${holeAny}, totalling ${hm(holeAnyMin * 60000)} of ${hm(span)} (${(100 * holeAnyMin * 60000 / span).toFixed(1)}% uncovered); longest ${longest ? hm(longest.len) + " from " + iso(longest.from) + " to " + iso(longest.to) : "—"}`);
}

function orderTable(all) {
  const fin = all["finalize-week.yml"].filter((r) => r.event === "schedule");
  const news = all["generate-newsletter.yml"].filter((r) => r.event === "schedule");
  const proj = all["sync-projections.yml"].filter((r) => r.event === "schedule");
  const waiv = all["process-waivers.yml"].filter((r) => r.event !== "push");
  const wednesdays = slots("finalize-week.yml", D(WORKFLOWS["finalize-week.yml"].validFrom), NOW);
  log(`\n### Order on each Wednesday (scheduled runs only; "after finish" = newsletter start minus finalize end)`);
  log(`| Wednesday | finalize start → end | newsletter start | after finalize finished? | sync-projections start | after finalize finished? | process-waivers runs overlapping finalize |`);
  log(`|---|---|---|---|---|---|---|`);
  const pick = (rs, s) => rs.find((r) => D(r.created_at) >= s && D(r.created_at) - s < 7 * 86400000);
  for (const s of wednesdays) {
    const f = pick(fin, s), n = pick(news, new Date(s.getTime() + 30 * 60000)), p = pick(proj, new Date(s.getTime() + 60 * 60000));
    if (!f && !n && !p) { log(`| ${ymd(s)} | — | — | | — | | |`); continue; }
    const fEnd = f ? ended(f) : null;
    const rel = (r) => !r ? "—" : !f ? "no finalize run" : (started(r) >= fEnd ? `yes, +${hm(started(r) - fEnd)}` : `**no**, ${hm(started(r) - fEnd)}`);
    const overl = f ? waiv.filter((r) => started(r) < fEnd && ended(r) > started(f)).length : 0;
    log(`| ${ymd(s)} | ${f ? iso(started(f)) + " → " + iso(fEnd) + " (" + f.conclusion + ")" : "—"} | ${n ? iso(started(n)) : "—"} | ${rel(n)} | ${p ? iso(started(p)) : "—"} | ${rel(p)} | ${overl} |`);
  }
}

// ───────────────────────────── MAIN ─────────────────────────────
const all = FROM ? loadFrom(FROM) : await fetchAll();
for (const file of Object.keys(all)) {
  // dedupe (windows can touch) and keep attempts as one run
  const seen = new Set();
  all[file] = all[file].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

log(`# Cron census — measured ${iso(NOW)}${FROM ? " from saved API output" : ` live (${requests} API requests, ${token() ? "token sent" : "no token"})`}`);
const inProgress = Object.entries(all).flatMap(([f, rs]) => rs.filter((r) => r.status !== "completed").map((r) => `${WORKFLOWS[f].label} ${iso(started(r))} (${r.status})`));
log(`- runs not yet completed at measurement time: ${inProgress.length ? inProgress.join("; ") : "none"}`);
const latest = Object.entries(all).map(([f, rs]) => { const l = [...rs].sort((a, b) => started(b) - started(a))[0]; return `${WORKFLOWS[f].label} ${rs.length} runs, latest ${iso(started(l))} ${l.conclusion || l.status}`; });
log(`- totals: ${latest.join("; ")}`);

log(`\n## Per workflow: runs by event and conclusion`);
for (const file of Object.keys(WORKFLOWS)) perWorkflowCounts(file, all[file]);

log(`\n## Run duration (completed runs, push events excluded)`);
log(`| workflow | period | runs | median | worst | by conclusion |`);
log(`|---|---|---|---|---|---|`);
for (const file of Object.keys(WORKFLOWS)) durations(file, all[file]);

log(`\n## The three Wednesday jobs: delay from slot to run_started_at`);
for (const file of WEDNESDAY_JOBS) wednesdayTable(file, all[file]);

orderTable(all);

log(`\n## score-matchups and process-waivers: slots declared vs runs started, gaps between run starts`);
for (const file of ["score-matchups.yml", "process-waivers.yml"]) dailyGaps(file, all[file]);

coverage(all["score-matchups.yml"]);
