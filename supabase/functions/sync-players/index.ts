import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Fantasy-relevant positions only
const RELEVANT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SleeperPlayer = Record<string, any>;

// Normalize a player name for fuzzy matching across data sources
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")          // T.J. → tj
    .replace(/'/g, "")           // O'Dell → odell
    .replace(/[^a-z\s]/g, " ")   // other punctuation → space
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "") // strip suffixes
    .replace(/\s+/g, " ")
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FFCPlayer = Record<string, any>;

Deno.serve(async (req: Request) => {
  // Bearer-token guard — only the cron (or manual invoke) can call this
  const authHeader = req.headers.get("Authorization") ?? "";
  const syncSecret = Deno.env.get("SYNC_SECRET");
  if (syncSecret && authHeader !== `Bearer ${syncSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 1. Fetch all NFL players from Sleeper ───────────────────────────────
  let sleeperData: Record<string, SleeperPlayer>;
  try {
    const res = await fetch("https://api.sleeper.app/v1/players/nfl");
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Sleeper API returned ${res.status}` }),
        { status: 502 },
      );
    }
    sleeperData = await res.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Sleeper fetch failed: ${String(err)}` }),
      { status: 502 },
    );
  }

  // ── 2. Fetch Fantasy Football Calculator PPR ADP (free public API) ────
  let adpMap = new Map<string, number>();
  try {
    const year = new Date().getFullYear();
    const ffcRes = await fetch(
      `https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=${year}`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; UFF/1.0)" } },
    );
    if (ffcRes.ok) {
      const data = await ffcRes.json();
      const players: FFCPlayer[] = data?.players ?? [];
      for (const p of players) {
        if (p.name && typeof p.adp === "number") {
          adpMap.set(normalizeName(p.name as string), p.adp as number);
        }
      }
      console.log(
        `[sync-players] FFC ADP loaded: ${adpMap.size} entries (${year})`,
      );
    } else {
      console.warn(
        `[sync-players] FFC ADP returned HTTP ${ffcRes.status} — skipping ADP update`,
      );
    }
  } catch (err) {
    console.warn(
      `[sync-players] FFC ADP fetch error: ${String(err)} — skipping ADP update`,
    );
  }

  const hasFpData = adpMap.size > 0;

  // ── 3. Map Sleeper players to our DB schema ─────────────────────────────
  const now = new Date().toISOString();

  type PlayerRow = {
    id: string;
    full_name: string;
    position: string | null;
    team: string | null;
    status: string | null;
    injury_status: string | null;
    updated_at: string;
    adp?: number | null;
  };

  const rows: PlayerRow[] = [];
  let adpMatched = 0;
  let maxFfcAdp = 0;
  // Players not matched by FFC but with a useful Sleeper search_rank — queued for synthetic ADP
  const needSyntheticAdp: Array<{ idx: number; searchRank: number }> = [];

  for (const [playerId, p] of Object.entries(sleeperData)) {
    if (!p || !p.full_name) continue;
    if (!RELEVANT_POSITIONS.has(p.position)) continue;

    const row: PlayerRow = {
      id: playerId,
      full_name: p.full_name as string,
      position: (p.position as string) ?? null,
      team: (p.team as string) ?? null,
      status: (p.status as string) ?? "Inactive",
      injury_status: (p.injury_status as string) ?? null,
      updated_at: now,
    };

    if (hasFpData) {
      const norm = normalizeName(p.full_name as string);
      const adp = adpMap.get(norm) ?? null;
      if (adp !== null) {
        row.adp = adp;
        adpMatched++;
        if (adp > maxFfcAdp) maxFfcAdp = adp;
      } else {
        // Not in FFC — queue for synthetic ADP based on Sleeper's own search_rank
        const sr = p.search_rank as number | undefined;
        if (typeof sr === "number" && sr < 9_000_000) {
          needSyntheticAdp.push({ idx: rows.length, searchRank: sr });
        }
        row.adp = null; // placeholder — filled in after the loop
      }
    }

    rows.push(row);
  }

  // Assign synthetic ADP to top-N unmatched players ranked by Sleeper's search_rank.
  // They slot in right after the last FFC pick so the overall ordering is coherent:
  // FFC picks (precise PPR ADP) → Sleeper-ranked unmatched (synthetic) → null (irrelevant)
  let syntheticAssigned = 0;
  if (hasFpData && needSyntheticAdp.length > 0) {
    needSyntheticAdp.sort((a, b) => a.searchRank - b.searchRank);
    const syntheticStart = maxFfcAdp > 0 ? Math.ceil(maxFfcAdp) + 1 : 201;
    const toAssign = needSyntheticAdp.slice(0, 250);
    toAssign.forEach((item, i) => {
      rows[item.idx].adp = syntheticStart + i;
    });
    syntheticAssigned = toAssign.length;
    console.log(
      `[sync-players] Synthetic ADP assigned to ${syntheticAssigned} additional players (starting at ${syntheticStart})`,
    );
  }

  // ── 4. Batch upsert in chunks of 500 ───────────────────────────────────
  const CHUNK_SIZE = 500;
  let upserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("players")
      .upsert(chunk, { onConflict: "id" });

    if (error) {
      errors.push(error.message);
    } else {
      upserted += chunk.length;
    }
  }

  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Partial failure", details: errors, upserted }),
      { status: 500 },
    );
  }

  const msg = hasFpData
    ? `[sync-players] synced ${upserted}/${rows.length} players, ADP matched ${adpMatched} (FFC) + ${syntheticAssigned} synthetic (Sleeper) = ${adpMatched + syntheticAssigned} total ranked`
    : `[sync-players] synced ${upserted}/${rows.length} players (no ADP update — FFC fetch failed)`;
  console.log(msg);

  return new Response(
    JSON.stringify({
      ok: true,
      synced: upserted,
      total: rows.length,
      adpMatched: hasFpData ? adpMatched : null,
      adpSynthetic: hasFpData ? syntheticAssigned : null,
      adpTotalRanked: hasFpData ? adpMatched + syntheticAssigned : null,
      adpSource: hasFpData ? "fantasyfootballcalculator-ppr + sleeper-search-rank" : null,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
