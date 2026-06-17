import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Fantasy-relevant positions only
const RELEVANT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SleeperPlayer = Record<string, any>;

Deno.serve(async (req: Request) => {
  // Simple bearer-token guard so only the cron can trigger this
  const authHeader = req.headers.get("Authorization") ?? "";
  const syncSecret = Deno.env.get("SYNC_SECRET");
  if (syncSecret && authHeader !== `Bearer ${syncSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
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
      JSON.stringify({ error: `Fetch failed: ${String(err)}` }),
      { status: 502 },
    );
  }

  // ── 2. Map to our schema ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const rows: {
    id: string;
    full_name: string;
    position: string | null;
    team: string | null;
    status: string | null;
    injury_status: string | null;
    updated_at: string;
  }[] = [];

  for (const [playerId, p] of Object.entries(sleeperData)) {
    if (!p || !p.full_name) continue;
    if (!RELEVANT_POSITIONS.has(p.position)) continue;

    rows.push({
      id: playerId,
      full_name: p.full_name as string,
      position: (p.position as string) ?? null,
      team: (p.team as string) ?? null,
      status: (p.status as string) ?? "Inactive",
      injury_status: (p.injury_status as string) ?? null,
      updated_at: now,
    });
  }

  // ── 3. Batch upsert in chunks of 500 ───────────────────────────────────
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

  console.log(`[sync-players] synced ${upserted} / ${rows.length} players`);
  return new Response(
    JSON.stringify({ ok: true, synced: upserted, total: rows.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
