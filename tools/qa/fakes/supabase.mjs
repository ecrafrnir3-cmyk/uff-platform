// In-memory stand-in for the Supabase clients (server, admin and supabase-js), used ONLY by
// tools/qa/check-parity.mjs to run the real route handlers offline. It answers the PostgREST
// query shapes the twelve AI call sites use from globalThis.__QA__.db (a per-case snapshot of the
// fixture), and records every write without doing anything: nothing here can reach a database.
//
// Supported: select("a, b, rel(x, y)") with one level of many-to-one embeds, eq, neq, is(null),
// in, not(col, "is", null), order (asc/desc, nullsFirst), limit, maybeSingle, single, returns,
// and update/upsert/insert/delete/rpc (recorded, never applied).

const EMBEDS = {
  'uff_roster_players.players': { table: 'players', local: 'player_id', foreign: 'id' },
  'uff_draft_picks.players': { table: 'players', local: 'player_id', foreign: 'id' },
  'uff_matchups.league_members': { table: 'league_members', local: 'member_id', foreign: 'id' },
};

const state = () => {
  if (!globalThis.__QA__) throw new Error('fake supabase used without globalThis.__QA__');
  return globalThis.__QA__;
};

function parseSelect(sel) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((c) => {
    const m = c.match(/^(\w+)\((.*)\)$/);
    return m ? { embed: m[1], cols: parseSelect(m[2]) } : { col: c };
  });
}

const same = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orders = [];
    this.lim = null;
    this.mode = 'many';
    this.cols = null;
    this.write = null;
  }
  select(sel = '*') { this.cols = sel === '*' ? null : parseSelect(sel); return this; }
  eq(c, v) { this.filters.push((r) => same(r[c], v)); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== null && r[c] !== undefined && !same(r[c], v)); return this; }
  is(c, v) { this.filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
  in(c, arr) { const s = new Set((arr || []).map(String)); this.filters.push((r) => r[c] !== null && r[c] !== undefined && s.has(String(r[c]))); return this; }
  not(c, op, v) {
    if (op !== 'is' || v !== null) throw new Error(`fake supabase: not(${c}, ${op}, ${v}) unsupported`);
    this.filters.push((r) => r[c] !== null && r[c] !== undefined);
    return this;
  }
  order(c, opts = {}) { this.orders.push({ c, asc: opts.ascending !== false, nullsFirst: opts.nullsFirst }); return this; }
  limit(n) { this.lim = n; return this; }
  returns() { return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  single() { this.mode = 'single'; return this; }
  update(v) { this.write = { op: 'update', v }; return this; }
  upsert(v, o) { this.write = { op: 'upsert', v, o }; return this; }
  insert(v) { this.write = { op: 'insert', v }; return this; }
  delete() { this.write = { op: 'delete' }; return this; }

  run() {
    const S = state();
    if (this.write) {
      S.writes.push({ table: this.table, ...this.write });
      return { data: null, error: null };
    }
    const all = S.db[this.table];
    if (!all) throw new Error(`fake supabase: no table ${this.table} in the case snapshot`);
    let rows = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length) {
      rows = rows.map((r, i) => [r, i]).sort(([a, ai], [b, bi]) => {
        for (const o of this.orders) {
          const x = a[o.c], y = b[o.c];
          const xn = x === null || x === undefined, yn = y === null || y === undefined;
          if (xn || yn) {
            if (xn && yn) continue;
            const nullsFirst = o.nullsFirst ?? !o.asc; // PostgreSQL: NULLS LAST for ASC, FIRST for DESC
            return xn ? (nullsFirst ? -1 : 1) : (nullsFirst ? 1 : -1);
          }
          const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
          if (cmp) return o.asc ? cmp : -cmp;
        }
        return ai - bi;
      }).map(([r]) => r);
    }
    if (this.lim != null) rows = rows.slice(0, this.lim);
    const shaped = rows.map((r) => this.shape(r));
    if (this.mode === 'many') return { data: shaped, error: null };
    if (shaped.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
    if (this.mode === 'single' && shaped.length === 0) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    return { data: shaped[0] ?? null, error: null };
  }
  shape(r) {
    if (!this.cols) return { ...r };
    const o = {};
    for (const c of this.cols) {
      if (c.col) { o[c.col] = r[c.col] === undefined ? null : r[c.col]; continue; }
      const e = EMBEDS[`${this.table}.${c.embed}`];
      if (!e) throw new Error(`fake supabase: unknown embed ${this.table}.${c.embed}`);
      const target = (state().db[e.table] || []).find((x) => same(x[e.foreign], r[e.local]));
      o[c.embed] = target ? Object.fromEntries(c.cols.map((cc) => [cc.col, target[cc.col] === undefined ? null : target[cc.col]])) : null;
    }
    return o;
  }
  then(resolve, reject) {
    try { return Promise.resolve(this.run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
  }
}

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: state().user ?? null }, error: null }) },
    from: (t) => new Query(t),
    rpc: async (name, args) => { state().writes.push({ rpc: name, args }); return { data: null, error: null }; },
  };
}

// One createClient serves both callers: @supabase/supabase-js's createClient(url, key) is used
// synchronously, @/lib/supabase/server's is awaited, and awaiting a non-promise (the client is not
// thenable) gives the client back.
export function createClient() { return makeClient(); }
export function createAdminClient() { return makeClient(); } // @/lib/supabase/admin
